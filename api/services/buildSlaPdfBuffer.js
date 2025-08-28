// services/buildSlaPdfBuffer.js
import PDFDocument from 'pdfkit';
import { drawLogoHeader } from '../../utils/pdf-branding.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// From /api/services -> /api/assets (check case: "assets" on Vercel)
const LOCAL_LOGO = path.resolve(__dirname, '../assets/Group 1642logo (1).png');

export async function buildSlaPdfBuffer(params = {}) {
  const {
    company = {},
    customer = {},
    slaNumber = `SLA-${new Date().toISOString().slice(0,10).replace(/-/g,'')}`,
    effectiveDateISO = new Date().toISOString().slice(0,10),
    noticeDays = 30,

    // fees (VAT calc if needed later)
    vatRate = 0.15,

    // lines for Services Ordered
    services = [],
    itemsMonthly = [],
    minutesIncluded = 0,

    // Debit order prefill
    debitOrder = {},
    serviceDescription = 'Hosted PBX incl. porting, provisioning & remote support'
  } = params;

  // ---- Palette ----
  const INK    = '#111827';
  const MUTED  = '#4B5563';
  const BG     = '#F5F5F7';
  const BORDER = '#E5E7EB';
  const BLUE   = '#0B63E6';

  // ---- Utils ----
  const money = (n) =>
    'R ' + Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const doc = new PDFDocument({ size: 'A4', margin: 32 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  // ---- Geometry
  const L = 40, R = doc.page.width - 40, W = R - L;
  const FOOTER_H = 26;
  const pageBottom = () => doc.page.height - doc.page.margins.bottom;
  let y = doc.y;

  const hasSpace = (need) => doc.y <= (pageBottom() - (need + FOOTER_H));
  const moveY = (amt = 0) => { y = (doc.y = (doc.y + amt)); };

  // ---- Shared helpers
  const footer = (pageIdx /*1-based*/) => {
    const yFooter = doc.page.height - 24;
    doc.font('Helvetica').fontSize(7).fillColor(MUTED)
      .text(`Agreement No: ${slaNumber} • Page ${pageIdx} of 3`, L, yFooter, { width: W, align: 'right' });
  };

  const newPageWithHeader = async (title, { subtitle = 'Effective from signing date • Confidential', align = 'right' } = {}) => {
    if (doc.page && doc.page.number > 1) doc.addPage();
    y = await drawLogoHeader(doc, {
      logoUrl: company?.logoUrl || '',
      localLogoHints: [ LOCAL_LOGO ],
      align,
      title,
      subtitle,
      maxLogoWidth: 130,
      top: 18
    });
    y = Math.max(y, 70);
    doc.y = y;

    // Meta strip (Page 1 only uses shaded strip; later pages keep header clean)
    if (doc.page.number === 1 && hasSpace(24)) {
      doc.save(); doc.rect(L, y, W, 20).fill(BG); doc.restore();
      doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(9)
        .text(`Agreement No: ${slaNumber}`, L + 10, y + 6, { continued: true })
        .fillColor(MUTED).font('Helvetica')
        .text('  •  Effective from date of signing');
      moveY(26);
    }
  };

  // ---------- Card helpers ----------
  const drawCard = (title, contentCb, options = {}) => {
    const { headerH = 18, minHeight = 72, gapAfter = 12, innerPad = 12 } = options;
    const cardTop = y;
    const x0 = L, w0 = W;

    const titleX = x0 + innerPad;
    const titleY = cardTop + 8;
    const contentLeft = x0 + innerPad;
    const contentTop  = cardTop + headerH + 6;
    const contentW    = w0 - innerPad * 2;

    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(title, titleX, titleY, { width: contentW });

    doc.y = contentTop; y = contentTop;
    contentCb({ x: contentLeft, w: contentW });

    const contentBottom = y + 8;
    const hCard = Math.max(minHeight, contentBottom - cardTop);

    doc.save();
    doc.roundedRect(x0, cardTop, w0, hCard, 10).strokeColor(BORDER).lineWidth(1).stroke();
    doc.restore();

    doc.y = cardTop + hCard + gapAfter; y = doc.y;
  };

  // Two-up with 120-width inputs; Address/Service Address allow two lines
  const drawTwoUpCard = (title, leftCb, rightCb) => {
    const innerPad = 12, headerH = 18, colGap = 18;
    const cardTop = y, x0 = L, w0 = W;

    const titleX = x0 + innerPad, titleY = cardTop + 8;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(title, titleX, titleY, { width: w0 - innerPad * 2 });

    const innerLeft = x0 + innerPad, innerTop = cardTop + headerH + 6;
    const colsW = w0 - innerPad * 2 - colGap;
    const colW = colsW / 2;
    const leftX = innerLeft;
    const rightX = innerLeft + colW + colGap;

    let yLeft = innerTop, yRight = innerTop;

    const lf = (label, preset = '', lineW = 120, { lines = 1 } = {}) => {
      if (yLeft + 20 > pageBottom() - FOOTER_H - 10) return;
      const labelW = Math.min(150, Math.max(110, colW * 0.38));
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label, leftX, yLeft + 2, { width: labelW - 8 });
      const sx = leftX + labelW, ly = yLeft + 12;
      // underline area height = 12 per line
      const underlineW = Math.min(lineW, colW - labelW - 8);
      for (let i = 0; i < lines; i++) {
        const yLine = ly + (i * 12);
        doc.moveTo(sx, yLine).lineTo(sx + underlineW, yLine).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
      }
      if (preset) doc.font('Helvetica').fontSize(8).fillColor(INK).text(String(preset), sx + 2, yLeft + 4, { width: underlineW - 6, ellipsis: true });
      yLeft += 18 + (lines - 1) * 10;
    };
    const rf = (label, preset = '', lineW = 120, { lines = 1 } = {}) => {
      if (yRight + 20 > pageBottom() - FOOTER_H - 10) return;
      const labelW = Math.min(150, Math.max(110, colW * 0.38));
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label, rightX, yRight + 2, { width: labelW - 8 });
      const sx = rightX + labelW, ly = yRight + 12;
      const underlineW = Math.min(lineW, colW - labelW - 8);
      for (let i = 0; i < lines; i++) {
        const yLine = ly + (i * 12);
        doc.moveTo(sx, yLine).lineTo(sx + underlineW, yLine).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
      }
      if (preset) doc.font('Helvetica').fontSize(8).fillColor(INK).text(String(preset), sx + 2, yRight + 4, { width: underlineW - 6, ellipsis: true });
      yRight += 18 + (lines - 1) * 10;
    };

    // Column headings
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('Provider Details', leftX, innerTop - 2);
    yLeft += 12;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('Customer Details', rightX, innerTop - 2);
    yRight += 12;

    leftCb({ lf, leftX, colW });
    rightCb({ rf, rightX, colW });

    const contentBottom = Math.max(yLeft, yRight) + 8;
    const hCard = Math.max(96, (contentBottom - cardTop));

    doc.save();
    doc.roundedRect(x0, cardTop, w0, hCard, 10).strokeColor(BORDER).lineWidth(1).stroke();
    const midX = leftX + colW + (colGap / 2);
    doc.moveTo(midX, innerTop - 6).lineTo(midX, cardTop + hCard - 8).strokeColor('#EFEFEF').lineWidth(1).stroke();
    doc.restore();

    doc.y = cardTop + hCard + 12; y = doc.y;
  };

  // ---- Services derive (robust)
  const deriveServices = () => {
    if (Array.isArray(services) && services.length) return services;
    if (!Array.isArray(itemsMonthly) || !itemsMonthly.length) return [];

    const globMin = Number(minutesIncluded || 0);
    const num = (v) => (Number.isFinite(Number(v ?? 0)) ? Number(v) : 0);
    const pickNum = (obj, keys = []) => {
      for (const k of keys) {
        const n = num(obj?.[k]);
        if (n !== 0) return n;
      }
      for (const k of keys) if (k in (obj || {})) return 0;
      return NaN;
    };

    return itemsMonthly.map((it = {}) => {
      const name = String(it?.name || it?.title || it?.description || '').trim();
      const looksLikeCalls = /call|min(ute)?s?/i.test(name);
      const mins = num(it?.minutes ?? it?.minutesIncluded ?? it?.includedMinutes ?? globMin);
      const note = looksLikeCalls && mins > 0 ? `Includes ${mins} minutes` : '';

      let unitPrice = pickNum(it, ['unit', 'unitPrice', 'unit_ex_vat', 'unitExVat']);
      if (Number.isNaN(unitPrice))
        unitPrice = pickNum(it, ['monthly', 'priceMonthly', 'amountMonthly', 'perMonth', 'price_ex_vat', 'priceExVat', 'price']);
      if (Number.isNaN(unitPrice)) unitPrice = 0;

      let qty = pickNum(it, ['qty', 'quantity', 'count']);
      if (Number.isNaN(qty)) {
        if (Array.isArray(it.devices)) qty = it.devices.length;
        else if (num(it.extensions) > 0) qty = num(it.extensions);
        else qty = 1;
      }
      if (qty <= 0) qty = 1;

      return { name, qty, unitPrice, note };
    });
  };
  const svc = deriveServices();

  // =========================
  // PAGE 1 — Parties + Services Ordered
  // =========================
  await newPageWithHeader('Service Level Agreement', { subtitle: 'Effective from signing date • Confidential', align: 'right' });

  // Parties card
  drawTwoUpCard('Parties — Details (Fill In)',
    ({ lf }) => {
      lf('Provider Name',  company?.name || 'VoIP Shop');
      lf('VAT Number',     company?.vat || '');
      lf('Phone',          company?.phone || '');
      lf('Email',          company?.email || '');
      lf('Website',        company?.website || '');
      lf('Address',        company?.address || '', 120, { lines: 2 });
    },
    ({ rf }) => {
      rf('Customer / Company', customer?.name || customer?.company || '');
      rf('Reg Number',         customer?.reg || '');
      rf('VAT Number',         customer?.vat || '');
      rf('Contact Person',     customer?.contact || '');
      rf('Phone',              customer?.phone || '');
      rf('Email',              customer?.email || '');
      rf('Service Address',    customer?.address || '', 120, { lines: 2 });
    }
  );

  // Services Ordered
  // If space is tight, go to a new page 1 (forced) is not desired, so break to new page 2?—We want Services on page 1, so break right here to a fresh page 1 continuation is not acceptable.
  // Instead: if <180px left, force a page break and then still mark this page as Page 1 of 3? We want deterministic: always page 1 content ends with services if needed.
  const NEED_SERV = 180; // header + a few rows + totals
  if (!hasSpace(NEED_SERV)) {
    doc.addPage();
    y = Math.max(doc.y, 70);
    doc.y = y;
  }

  drawCard('Services Ordered (Monthly)', ({ x, w }) => {
    const cW = [ w * 0.52, w * 0.12, w * 0.16, w * 0.20 ];
    const rx = [ x, x + cW[0], x + cW[0] + cW[1], x + cW[0] + cW[1] + cW[2] ];

    // Header
    doc.font('Helvetica-Bold').fontSize(8.2).fillColor(INK);
    doc.text('Description', rx[0], y, { width: cW[0] });
    doc.text('Qty',         rx[1], y, { width: cW[1], align: 'right' });
    doc.text('Unit Price',  rx[2], y, { width: cW[2], align: 'right' });
    doc.text('Line Total',  rx[3], y, { width: cW[3], align: 'right' });
    moveY(8);
    doc.moveTo(x, y).lineTo(x + w, y).strokeColor('#D1D5DB').lineWidth(1).stroke();
    moveY(4);

    if (!svc.length) {
      doc.font('Helvetica').fontSize(7.8).fillColor(MUTED)
        .text('No monthly service lines were supplied. (Pass `services` OR `itemsMonthly` + `minutesIncluded`.)', x, y, { width: w });
      moveY(10);
      return;
    }

    const rowH = 10;
    const FUDGE_HDR = 30;
    const roomForRows = (pageBottom() - FOOTER_H) - y - FUDGE_HDR;
    let maxRows = Math.max(0, Math.floor(roomForRows / rowH));

    doc.font('Helvetica').fontSize(7.8).fillColor(MUTED);
    let subtotal = 0, rendered = 0;

    for (let i = 0; i < svc.length && rendered < maxRows; i++) {
      const it = svc[i];
      const lineTotal = (Number(it.unitPrice) || 0) * (Number(it.qty) || 0);
      subtotal += Number.isFinite(lineTotal) ? lineTotal : 0;

      doc.text(it.name || '',                rx[0], y, { width: cW[0] });
      doc.text(String(it.qty || 0),          rx[1], y, { width: cW[1], align: 'right' });
      doc.text(it.unitPrice > 0 ? money(it.unitPrice) : '—', rx[2], y, { width: cW[2], align: 'right' });
      doc.text(money(lineTotal),             rx[3], y, { width: cW[3], align: 'right' });
      moveY(rowH);

      if (it.note) {
        const noteH = doc.heightOfString(it.note, { width: cW[0], lineGap: 0.1 });
        doc.font('Helvetica-Oblique').fillColor(MUTED)
           .text(it.note, rx[0], y - 1, { width: cW[0], lineGap: 0.1 });
        doc.font('Helvetica').fillColor(MUTED);
        moveY(Math.min(6, noteH));
      }
      rendered++;
    }

    const remaining = Math.max(0, svc.length - rendered);
    if (remaining > 0) {
      doc.font('Helvetica-Oblique').fontSize(7.8).fillColor(MUTED)
        .text(`+${remaining} more item(s) included in totals`, x, y, { width: w });
      moveY(8);
      doc.font('Helvetica').fontSize(7.8).fillColor(MUTED);
    }

    const vat = subtotal * Number(vatRate || 0);
    const total = subtotal + vat;

    moveY(2);
    doc.moveTo(x, y).lineTo(x + w, y).strokeColor('#E5E7EB').lineWidth(1).stroke();
    moveY(3);

    const labelW = 112, valW = 104;
    const valX = x + w - valW, labX = valX - labelW - 6;

    const line = (label, val, bold=false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
         .fontSize(bold ? 8.4 : 8)
         .fillColor(bold ? INK : MUTED)
         .text(label, labX, y, { width: labelW, align: 'right' });
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(INK)
         .text(money(val), valX, y, { width: valW, align: 'right' });
      moveY(bold ? 9 : 8);
    };
    line('Monthly Subtotal (ex VAT)', subtotal);
    line(`VAT (${Math.round(Number(vatRate||0)*100)}%)`, vat);
    line('Monthly Total (incl VAT)', total, true);
  }, { minHeight: 72 });

  // Footer Page 1
  footer(1);

  // =========================
  // PAGE 2 — Debit Order Mandate + T&Cs
  // =========================
  await newPageWithHeader('Debit Order Mandate', { subtitle: 'Effective from signing date • Confidential', align: 'left' });

  drawCard('Debit Order Mandate (Fill In)', (box) => {
    const labelW = 140;

    const fill = (label, preset = '', width = box.w - labelW - 22) => {
      if (!hasSpace(18)) return;
      const lx = box.x + labelW;
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label, box.x, y + 2, { width: labelW - 10 });
      const ly = y + 11;
      doc.moveTo(lx, ly).lineTo(lx + width, ly).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
      if (preset) doc.font('Helvetica').fontSize(8).fillColor(INK)
        .text(String(preset), lx + 2, y + 3, { width: width - 4, ellipsis: true });
      moveY(16);
    };

    const fillTwoUp = (
      labelA, presetA = '', widthA = 140,
      labelB, presetB = '', widthB = 160,
      gap = 24
    ) => {
      if (!hasSpace(18)) return;
      const lxA = box.x + labelW;
      doc.font('Helvetica').fontSize(8).fillColor(MUTED)
        .text(labelA, box.x, y + 2, { width: labelW - 10 });
      const ly = y + 11;
      doc.moveTo(lxA, ly).lineTo(lxA + widthA, ly).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
      if (presetA) doc.font('Helvetica').fontSize(8).fillColor(INK)
        .text(String(presetA), lxA + 2, y + 3, { width: widthA - 4, ellipsis: true });

      const xRight = lxA + widthA + gap;
      const labelW2 = 110;
      const lxB = xRight + labelW2;
      const maxWB = Math.max(40, Math.min(widthB, (box.x + box.w) - lxB - 4));
      doc.font('Helvetica').fontSize(8).fillColor(MUTED)
        .text(labelB, xRight, y + 2, { width: labelW2 - 10 });
      doc.moveTo(lxB, ly).lineTo(lxB + maxWB, ly).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
      if (presetB) doc.font('Helvetica').fontSize(8).fillColor(INK)
        .text(String(presetB), lxB + 2, y + 3, { width: maxWB - 4, ellipsis: true });

      moveY(16);
    };

    // Prefill rows
    fill('Account Holder', debitOrder?.accountName || '');
    fill('Bank', debitOrder?.bank || '');
    fill('Branch Code', debitOrder?.branchCode || '');
    fill('Account Number', debitOrder?.accountNumber || '');
    fill('Account Type (e.g., Cheque/Savings)', debitOrder?.accountType || '');

    fillTwoUp(
      'Collection Day (1–31)', debitOrder?.dayOfMonth != null ? `Day ${debitOrder.dayOfMonth}` : '', 120,
      'Mandate Date (YYYY-MM-DD)', debitOrder?.mandateDateISO || '', 140, 28
    );

    // Signature block + Date block
    if (hasSpace(60)) {
      const gap = 20;
      const sigW = Math.min((box.w * 0.68), box.w - 160 - gap);
      const dateW = Math.min(140, box.w - sigW - gap);

      const labelY = y + 2;
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Customer Signature', box.x, labelY);

      const sigY = y + 18, sigH = 42;
      doc.save().roundedRect(box.x, sigY, sigW, sigH, 6).fill('#F5F6F7').restore();
      doc.roundedRect(box.x, sigY, sigW, sigH, 6).strokeColor('#E5E7EB').lineWidth(1).stroke();

      const dateX = box.x + sigW + gap;
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Date', dateX, labelY);
      doc.save().roundedRect(dateX, sigY, dateW, sigH, 6).fill('#F9FAFB').restore();
      doc.roundedRect(dateX, sigY, dateW, sigH, 6).strokeColor('#E5E7EB').lineWidth(1).stroke();

      y = sigY + sigH + 8; doc.y = y;
    }
  }, { minHeight: 140 });

  // Bank-required Debit Order T&Cs
  drawCard('Debit Order Terms & Conditions', ({ x, w }) => {
    const bullets = [
      'The Customer authorises VoIP Shop and/or its nominated agent to debit the above bank account for all amounts due under this Agreement.',
      'Debits may occur on or after the selected collection day; if the day falls on a weekend/public holiday, debits may run on the next business day.',
      'The Customer must ensure sufficient funds are available; unpaid debits may incur bank charges and service suspension.',
      'This mandate remains in force until cancelled in writing by the Customer with 30 days’ notice and all amounts due have been settled.',
      'Disputes must be raised in writing within 7 days of the debit; undisputed amounts remain payable.',
      'Any changes to banking details require a new signed mandate.'
    ];
    const lineGap = 3;
    for (const t of bullets) {
      if (!hasSpace(24)) break;
      const dotY = y + 5.5;
      doc.circle(x + 3, dotY, 1.1).fill('#6B7280');
      doc.fillColor(MUTED).font('Helvetica').fontSize(8)
         .text(t, x + 10, y, { width: w - 12, lineGap });
      moveY(10 + doc.heightOfString('', { width: 0 }));
      doc.fillColor(INK);
    }
  }, { minHeight: 120 });

  // Client initials bottom of page 2
  const initials2Y = pageBottom() - FOOTER_H - 8;
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Client Initials:', L, initials2Y, { width: 90 });
  doc.moveTo(L + 70, initials2Y + 10).lineTo(L + 170, initials2Y + 10).strokeColor('#9CA3AF').lineWidth(0.8).stroke();

  // Footer Page 2
  footer(2);

  // =========================
  // PAGE 3 — General Terms & Conditions
  // =========================
  await newPageWithHeader('Terms & Conditions', { subtitle: 'Effective from signing date • Confidential', align: 'left' });

  // Two-column layout
  const COL_GAP = 22;
  const COL_W = (W - COL_GAP) / 2;
  const colX = (i) => L + i * (COL_W + COL_GAP);
  const colTop = y;
  const colBottom = pageBottom() - FOOTER_H - 12;
  let colYs = [colTop, colTop];

  const tryWriteSection = (colIndex, title, bullets) => {
    let x = colX(colIndex);
    let yCursor = colYs[colIndex];

    const headerH = 16;
    const bulletsH = bullets.reduce((acc, t) => {
      const h = 12 + doc.heightOfString(String(t||''), { width: COL_W - 14, lineGap: 0.5 });
      return acc + h + 6;
    }, 0);

    const needed = headerH + bulletsH + 6;
    if (yCursor + needed > colBottom) return false;

    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(title, x, yCursor, { width: COL_W });
    doc.moveTo(x, doc.y + 2).lineTo(x + COL_W, doc.y + 2).strokeColor(BORDER).lineWidth(1).stroke();
    yCursor = doc.y + 8;

    for (const t of bullets) {
      const bx = x + 8;
      doc.circle(x + 2.5, yCursor + 3.2, 1.1).fill('#6B7280');
      doc.fillColor(MUTED).font('Helvetica').fontSize(7.8)
         .text(t, bx, yCursor, { width: COL_W - 12, lineGap: 0.5 });
      yCursor = doc.y + 6;
      doc.fillColor(INK);
    }

    yCursor += 6;
    colYs[colIndex] = yCursor;
    return true;
  };

  const placeSection = (title, bullets) => {
    if (!tryWriteSection(0, title, bullets)) {
      if (!tryWriteSection(1, title, bullets)) return false;
    }
    return true;
  };

  const sections = [
    {
      title: 'Support & Service Levels',
      bullets: [
        'Remote support included at no charge.',
        'On-site support by arrangement; call-out fee R450 per visit (travel/after-hours may apply).',
        'Hours: Mon–Fri 08:30–17:00 SAST; WhatsApp & email support available.',
        'Fault priority targets: P1 outage—response 1h, restore 8h; P2—response 4h, restore 1 business day; P3/MAC—response 1 business day, target 2–3 business days.',
        'Service is best-effort and may be impacted by external providers (ISP/carrier), local network quality, Wi-Fi, or power.'
      ]
    },
    {
      title: 'Fees, Billing & Payments',
      bullets: [
        'First invoice is payable upfront before activation. Thereafter billing occurs monthly in arrears (end of month).',
        'Payment must be made by debit order or EFT on or before the due date; late payments may result in service suspension.',
        'Interest on overdue amounts will accrue at prime + 6%.',
        'Prices exclude VAT unless otherwise stated.',
        'Usage/call charges are billed in arrears. Calls over and above the included monthly minutes are billed at 35c per local minute and 55c per mobile minute.',
        'The Service Order reflects fixed monthly services only and excludes any additional call usage.'
      ]
    },
    {
      title: 'Customer Responsibilities',
      bullets: [
        'Provide stable power, Internet, and site access for installation/support.',
        'Maintain LAN/Wi-Fi security; prevent misuse or fraud.',
        'Use equipment/services lawfully; comply with POPIA for call recording and notices to employees/customers.',
        'Remain liable for all charges incurred on the account, whether authorised or unauthorised.',
        'Implement QoS/backup power for critical operations (recommended).'
      ]
    },
    {
      title: 'Equipment, Porting & Warranty',
      bullets: [
        'Hardware sold once-off; ownership passes to Customer upon payment.',
        'Manufacturer warranties (typically 12 months, return-to-base) apply; excludes surges/liquids/abuse/unauthorised firmware.',
        'Loan devices may be offered at VoIP Shop’s discretion and current pricing.',
        'Number porting timelines subject to donor carrier processes; RICA requirements apply.'
      ]
    },
    {
      title: 'Data Protection (POPIA)',
      bullets: [
        'Both parties shall process personal information in compliance with POPIA.',
        'Where call recording is enabled, Customer must ensure lawful basis, appropriate notices to staff/callers, and retention/deletion policies.',
        'Customer is responsible for limiting access to recordings and ensuring secure storage of exported data.',
        'Any suspected breach must be reported without undue delay and cooperatively mitigated.'
      ]
    },
    {
      title: 'Service Limitations & Exclusions',
      bullets: [
        'Quality of service may be affected by Customer LAN/Wi-Fi, power, third-party ISP/carriers, or environmental factors outside VoIP Shop’s control.',
        'SLA does not cover force majeure events (e.g., load-shedding, strikes, disasters) or faults within third-party networks.',
        'Moves/Adds/Changes outside standard scope may be chargeable and are handled as P3 tickets.',
        'Hardware damage from surges/liquids/abuse and unauthorised firmware changes are excluded from warranty.'
      ]
    },
    {
      title: 'Security, Fair Use & Recording',
      bullets: [
        'Customer must safeguard credentials and endpoints; unusual usage may trigger proactive suspensions.',
        'Fair use applies to minutes and inclusive features to prevent abuse and protect network integrity.',
        'If call recording is enabled, Customer is responsible for obtaining all required consents and retention policies (POPIA).',
        'VoIP Shop may implement fraud controls and routing changes without notice to mitigate risk.'
      ]
    },
    {
      title: 'Maintenance, Changes & Escalations',
      bullets: [
        'Planned maintenance will be scheduled outside business hours where possible; emergency maintenance may occur at short notice.',
        'Configuration change requests (MACs) are handled as P3 tickets with 2–3 business day targets.',
        'Escalation path available on request; critical incidents prioritised based on impact.'
      ]
    },
    {
      title: 'Liability, Suspension & Termination',
      bullets: [
        'No liability for indirect, consequential, or special damages, including loss of profit or business.',
        'Liability cap: the lesser of 3 months’ service fees or R100,000.',
        `Month-to-month; either party may cancel on ${noticeDays} days’ written notice.`,
        'Non-payment may lead to suspension until all arrears are settled; upon termination, unpaid fees are immediately due.'
      ]
    },
    {
      title: 'General',
      bullets: [
        'This SLA forms part of the overall agreement (signed quotes/orders/policies). If conflicts arise, the latest signed quote/order prevails for pricing/line items.',
        'Changes to this SLA require written agreement by both parties.',
        'Governing law: South Africa; venue: Johannesburg.',
        'If any clause is unenforceable, the remainder remains in force.'
      ]
    }
  ];

  for (const sec of sections) {
    const ok = placeSection(sec.title, sec.bullets);
    if (!ok) break; // stop if we run out of space
  }

  // Column divider (visual)
  doc.save();
  const midX = (L + COL_W) + (COL_GAP / 2);
  doc.moveTo(midX, colTop - 4).lineTo(midX, colBottom + 4).strokeColor('#F0F0F0').lineWidth(1).stroke();
  doc.restore();

  // Client initials bottom of page 3
  const initials3Y = pageBottom() - FOOTER_H - 8;
  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
    .text('Client Initials:', L, initials3Y, { width: 90 });
  doc.moveTo(L + 70, initials3Y + 10).lineTo(L + 170, initials3Y + 10).strokeColor('#9CA3AF').lineWidth(0.8).stroke();

  // Footer Page 3
  footer(3);

  doc.end();
  return done;
}
