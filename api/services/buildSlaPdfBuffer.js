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

    // VAT / pricing
    vatRate = 0.15,

    // Primary inputs (but we’ll also sniff checkout/cart below)
    services = [],
    itemsMonthly = [],
    minutesIncluded = 0,

    // Debit order prefill
    debitOrder = {},
    serviceDescription = 'Hosted PBX incl. porting, provisioning & remote support',

    // Optional checkout/cart shapes we’ll normalize from
    checkout = {},
    cart = {}
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

  // ---- PDF init ----
  const doc = new PDFDocument({ size: 'A4', margin: 32 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  // ---- Geometry ----
  const L = 40, R = doc.page.width - 40, W = R - L;
  const FOOTER_H = 26;
  const pageBottom = () => doc.page.height - doc.page.margins.bottom;
  let y = doc.y;

  const hasSpace = (need) => doc.y <= (pageBottom() - (need + FOOTER_H));
  const moveY = (amt = 0) => { y = (doc.y = (doc.y + amt)); };

  // ---- Footer helper ----
  // includeAgreementNo=false removes the "Agreement No: ..." part
  const footer = (pageIdx /*1-based*/, includeAgreementNo = true) => {
    const yFooter = doc.page.height - 24;
    const rightText = includeAgreementNo
      ? `Agreement No: ${slaNumber} • Page ${pageIdx}`
      : `Page ${pageIdx}`;
    doc.font('Helvetica').fontSize(7).fillColor(MUTED)
      .text(rightText, L, yFooter, { width: W, align: 'right' });
  };

  // ---- Header helper (title left; logo right only on Page 1) ----
  const newPageWithHeader = async (title, {
    subtitle = 'Effective from signing date • Confidential',
    showLogo = true,         // << control logo on this page
  } = {}) => {
    if (doc.page && doc.page.number >= 1) {
      // For first call (page 1), number is 1 and we do NOT add a page.
      // For subsequent pages, add a page.
      if (doc.page.number > 1 || title !== 'Service Level Agreement') doc.addPage();
    }

    if (showLogo) {
      // Use the branding helper with logo
      y = await drawLogoHeader(doc, {
        logoUrl: company?.logoUrl || '',
        localLogoHints: [ LOCAL_LOGO ],
        align: 'right',
        title,
        subtitle,
        maxLogoWidth: 130,
        top: 18
      });
      y = Math.max(y, 70);
      doc.y = y;
    } else {
      // Minimal header (no logo)
      const topPad = 18;
      doc.font('Helvetica-Bold').fontSize(16).fillColor(INK)
         .text(title, L, topPad, { width: W, align: 'left' });
      if (subtitle) {
        doc.font('Helvetica').fontSize(9).fillColor(MUTED)
           .text(subtitle, L, doc.y + 2, { width: W, align: 'left' });
      }
      y = Math.max(doc.y + 10, 70);
      doc.y = y;
    }
  };

  // ---------- Card helpers ----------
  const drawCard = (cardTitle, contentCb, options = {}) => {
    const { headerH = 18, minHeight = 72, gapAfter = 12, innerPad = 12 } = options;
    const cardTop = y;
    const x0 = L, w0 = W;

    const titleX = x0 + innerPad;
    const titleY = cardTop + 8;
    const contentLeft = x0 + innerPad;
    const contentTop  = cardTop + headerH + 6;
    const contentW    = w0 - innerPad * 2;

    // Title (left)
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(cardTitle, titleX, titleY, { width: contentW });

    doc.y = contentTop; y = contentTop;
    contentCb({ x: contentLeft, w: contentW });

    const contentBottom = y + 8;
    const hCard = Math.max(minHeight, contentBottom - cardTop);

    doc.save();
    doc.roundedRect(x0, cardTop, w0, hCard, 10).strokeColor(BORDER).lineWidth(1).stroke();
    doc.restore();

    doc.y = cardTop + hCard + gapAfter; y = doc.y;
  };

  // Two-up: Parties card
  const drawTwoUpCard = (cardTitle, leftCb, rightCb) => {
    const innerPad = 12, headerH = 18, colGap = 18;
    const cardTop = y, x0 = L, w0 = W;

    const titleX = x0 + innerPad;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
       .text(cardTitle, titleX, cardTop + 8, { width: w0 - innerPad * 2 });

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

  // ---- Services derive (pull from checkout/cart/services) ----
  const deriveServices = () => {
    // Try the most likely monthly arrays first
    const candidates = [
      itemsMonthly,
      checkout?.itemsMonthly,
      checkout?.monthly,
      checkout?.items,
      cart?.itemsMonthly,
      cart?.monthly,
      cart?.items,
      services
    ].filter(Array.isArray);

    const items = candidates.find(a => a && a.length) || [];

    const globMin = Number(minutesIncluded || 0);
    const num = (v) => (Number.isFinite(Number(v ?? 0)) ? Number(v) : 0);

    // Pick the first numeric value from candidate keys (treat present-but-non-numeric as 0)
    const pickNum = (obj, keys = []) => {
      for (const k of keys) {
        if (obj && (k in obj)) {
          const n = num(obj[k]);
          return n;
        }
      }
      return 0;
    };

    return items.map((it = {}) => {
      const name = String(it?.name || it?.title || it?.description || it?.sku || it?.product || '').trim();

      // Minutes detection
      const looksLikeCalls = /call|min(ute)?s?/i.test(name);
      const mins = pickNum(it, [
        'minutes', 'minutesIncluded', 'includedMinutes',
        'qtyMinutes', 'qty_min', 'qtyMin', 'bundleMinutes'
      ]) || (looksLikeCalls ? globMin : 0);
      const note = (looksLikeCalls && mins > 0)
        ? `Includes ${mins} minutes`
        : String(it?.note || it?.notes || '').trim();

      // Unit price (prefer ex-VAT monthly)
      let unitPrice = pickNum(it, [
        'unit', 'unitPrice', 'unit_ex_vat', 'unitExVat', 'unit_price', 'unitPriceExVat',
        'unitMonthly', 'monthlyExVat', 'monthly', 'priceMonthly', 'amountMonthly',
        'perMonth', 'price_ex_vat', 'priceExVat', 'price', 'amount', 'net'
      ]);
      const unitCents = pickNum(it, ['unitCents', 'unit_cents', 'priceCents', 'price_cents']);
      if (!unitPrice && unitCents) unitPrice = unitCents / 100;

      // Quantity
      let qty = pickNum(it, ['qty', 'quantity', 'count', 'devices', 'units']);
      if (!qty || qty <= 0) qty = 1;

      return { name, qty, unitPrice, note };
    });
  };

  const svc = deriveServices();

  // =========================
  // PAGE 1 — Parties + Services Ordered
  // =========================
  await newPageWithHeader('Service Level Agreement', {
    subtitle: `Effective from ${effectiveDateISO} • Notice period ${noticeDays} days`,
    showLogo: true
  });

  // Blue strip with SLA number (Page 1 only)
  if (hasSpace(24)) {
    doc.save();
    doc.rect(L, y, W, 20).fill(BG).strokeColor(BORDER).lineWidth(1).stroke();
    doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(9)
      .text(`Agreement No: ${slaNumber}`, L + 10, y + 6, { continued: true })
      .fillColor(MUTED).font('Helvetica')
      .text('  •  Effective from date of signing');
    moveY(26);
    doc.restore();
  }

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

  // Services Ordered (Monthly)
  drawCard('Services Ordered (Monthly)', ({ x, w }) => {
    const cW = [ w * 0.52, w * 0.12, w * 0.16, w * 0.20 ];
    const rx = [ x, x + cW[0], x + cW[0] + cW[1], x + cW[0] + cW[1] + cW[2] ];

    // Header
    doc.save().rect(x, y, w, 14).fill('#F7F7F8').restore();
    doc.font('Helvetica-Bold').fontSize(8.2).fillColor(INK);
    doc.text('Description', rx[0], y + 3, { width: cW[0] });
    doc.text('Qty',         rx[1], y + 3, { width: cW[1], align: 'right' });
    doc.text('Unit Price',  rx[2], y + 3, { width: cW[2], align: 'right' });
    doc.text('Line Total',  rx[3], y + 3, { width: cW[3], align: 'right' });
    moveY(14);
    doc.moveTo(x, y).lineTo(x + w, y).strokeColor('#D1D5DB').lineWidth(1).stroke();
    moveY(4);

    const rows = Array.isArray(svc) ? svc : [];
    if (!rows.length) {
      doc.font('Helvetica').fontSize(7.8).fillColor(MUTED)
        .text('No monthly service lines were supplied. (Provide `itemsMonthly` or `checkout.itemsMonthly` etc.)', x, y, { width: w });
      moveY(10);
      return;
    }

    const rowH = 10;
    doc.font('Helvetica').fontSize(7.8).fillColor(MUTED);
    let subtotal = 0;

    for (const it of rows) {
      // Stop if no space for another row + totals (leave room for totals line)
      if (!hasSpace(rowH + 42)) break;

      const unit = Number(it.unitPrice) || 0;
      const qty = Number(it.qty) || 0;
      const lineTotal = unit * qty;
      subtotal += Number.isFinite(lineTotal) ? lineTotal : 0;

      doc.text(it.name || '',                rx[0], y, { width: cW[0] });
      doc.text(String(qty || 0),             rx[1], y, { width: cW[1], align: 'right' });
      doc.text(unit > 0 ? money(unit) : '—', rx[2], y, { width: cW[2], align: 'right' });
      doc.text(money(lineTotal),             rx[3], y, { width: cW[3], align: 'right' });
      moveY(rowH);

      if (it.note) {
        const noteH = doc.heightOfString(it.note, { width: cW[0], lineGap: 0.1 });
        doc.font('Helvetica-Oblique').fillColor(MUTED)
           .text(it.note, rx[0], y - 1, { width: cW[0], lineGap: 0.1 });
        doc.font('Helvetica').fillColor(MUTED);
        moveY(Math.min(6, noteH));
      }
    }

    const vat = subtotal * Number(vatRate || 0);
    const total = subtotal + vat;

    moveY(2);
    doc.moveTo(x, y).lineTo(x + w, y).strokeColor('#E5E7EB').lineWidth(1).stroke();
    moveY(3);

    const labelW = 160;
    const line = (label, val, bold=false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
         .fontSize(8).fillColor(bold ? INK : MUTED)
         .text(label, x + w - labelW - 110, y, { width: labelW, align: 'right' });
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(INK)
         .text(money(val), x + w - 100, y, { width: 100, align: 'right' });
      moveY(bold ? 10 : 9);
    };
    line('Monthly Subtotal (ex VAT)', subtotal);
    line(`VAT (${Math.round(Number(vatRate||0)*100)}%)`, vat);
    line('Monthly Total (incl VAT)', total, true);
  }, { minHeight: 72 });

 // Response Time & Downtime Policy — two clean text columns (no table)
drawCard('Response Time & Downtime Policy', ({ x, w }) => {
  const colGap = 18;
  const colW = (w - colGap) / 2;
  const leftX = x;
  const rightX = x + colW + colGap;

  const titleFont = () => doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK);
  const bodyFont  = () => doc.font('Helvetica').fontSize(8).fillColor(MUTED);

  // Local column writer that DOES NOT rely on global moveY/hasSpace
  const writeColumn = (tx, ty, tw, sections) => {
    let cy = ty;
    for (const sec of sections) {
      // Section title
      titleFont().text(sec.title, tx, cy, { width: tw });
      const th = doc.heightOfString(sec.title, { width: tw });
      cy += Math.max(10, th + 2);

      // Bullets
      bodyFont();
      const dotW = 9;
      for (const b of sec.bullets) {
        // bullet dot
        doc.text('•', tx, cy, { width: dotW, align: 'center' });
        // bullet text
        doc.text(b, tx + dotW, cy, { width: tw - dotW, lineGap: 0.3 });
        const bh = doc.heightOfString(b, { width: tw - dotW, lineGap: 0.3 });
        cy += Math.max(10, bh + 2);
      }

      cy += 4; // spacing after section
    }
    return cy; // bottom Y
  };

  // Keep columns aligned to the same starting Y
  const startY = y;

  // LEFT COLUMN
  const leftSections = [
    {
      title: 'Response Targets',
      bullets: [
        'P1 Outage: initial response ≤ 2 business hours; restore target ≤ 8 hours.',
        'P2 Major fault: initial response ≤ 4 business hours; restore target ≤ 1 business day.',
        'P3 / MAC (moves/adds/changes): response ≤ 1 business day; restore/complete within 2–3 business days.'
      ]
    },
    {
      title: 'Availability & Maintenance',
      bullets: [
        'Hosted PBX platform target availability: 99.5% per calendar month.',
        'Planned maintenance communicated ≥ 48 hours in advance and scheduled after-hours where feasible.'
      ]
    }
  ];
  const leftBottom = writeColumn(leftX, startY, colW, leftSections);

  // RIGHT COLUMN
  const rightSections = [
    {
      title: 'Scope & Exclusions',
      bullets: [
        'Remote support is primary. Onsite only if remote resolution is not possible (call-out fees may apply).',
        'Excludes: customer LAN/Wi-Fi/cabling, premises power, local ISP faults, third-party carrier outages, and force majeure.',
        'Customer availability is required for remote sessions and onsite scheduling.'
      ]
    },
    {
      title: 'Escalation',
      bullets: [
        'If not resolved within targets, escalate to onsite (fees may apply).',
        'Progress updates are provided until resolution.'
      ]
    }
  ];
  const rightBottom = writeColumn(rightX, startY, colW, rightSections);

  // Advance global y to the lower of the two columns + padding
  y = Math.max(leftBottom, rightBottom) + 6;
}, { minHeight: 96, headerH: 18, gapAfter: 8 });


  // Footer Page 1 (with Agreement No)
  footer(1, true);

  // =========================
  // PAGE 2 — Debit Order Mandate + T&Cs
  // =========================
  await newPageWithHeader('Debit Order Mandate', { subtitle: '', showLogo: false });

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
      labelA, presetA = '', widthA = 120,
      labelB, presetB = '', widthB = 140,
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

  // Debit Order Terms & Conditions (verbatim)
  drawCard('Debit Order Terms & Conditions', ({ x, w }) => {
    const paras = [
      'This signed Authority and Mandate refers to our contract dated: (“the Agreement”).',
      '',
      'I / We hereby authorise you to issue and deliver payment instructions to your Banker for collection against my / our abovementioned account at my / Our above-mentioned Bank (or any other bank or branch to which I / we may transfer my / our account) on condition that the sum of such payment instructions will never exceed my / our obligations as agreed to in the Agreement and continuing until this Authority and Mandate is terminated by me / us by giving you notice in writing of not less than 20 ordinary working days, and sent by prepaid registered post or delivered to your address as indicated above.',
      '',
      'The individual payment instructions so authorised to be issued must be issued and delivered as follows: monthly. In the event that the payment day falls on a Sunday, or recognised South African public holiday, the payment day will automatically be the preceding ordinary business day. Payment Instructions due in December may be debited against my account as per the agreement',
      '',
      'I / We understand that the withdrawals hereby authorized will be processed through a computerized system provided by the South African Banks and I also understand that details of each withdrawal will be printed on my bank statement. Each transaction will contain a number, which must be included in the said payment instruction and if provided to you should enable you to identify the Agreement. A payment reference is added to this form before the issuing of any payment instruction.',
      '',
      'Mandate',
      'I / We acknowledge that all payment instructions issued by you shall be treated by my / our above-mentioned Bank as if the instructions have been issued by me/us personally.',
      '',
      'Cancellation',
      'I / We agree that although this Authority and Mandate may be cancelled by me / us, such cancellation will not cancel the Agreement. I / We shall not be entitled to any refund of amounts which you have withdrawn while this Authority was in force, if such amounts were legally owing to you.',
      '',
      'Assignment',
      'I / We acknowledge that this Authority may be ceded or assigned to a third party if the Agreement is also ceded or assigned to that third party, but in the absence of such assignment of the Agreement, this Authority and Mandate cannot be assigned to any third party.'
    ];

    const writePara = (txt, isHeading = false) => {
      if (!hasSpace(18)) return false;
      if (isHeading) {
        doc.font('Helvetica-Bold').fontSize(8.2).fillColor(INK)
          .text(txt, x, y, { width: w });
        moveY(8);
      } else {
        doc.font('Helvetica').fontSize(8).fillColor(MUTED)
          .text(txt, x, y, { width: w, lineGap: 1.2 });
        moveY(10);
      }
      return true;
    };

    for (const p of paras) {
      if (p === '') { moveY(6); continue; }
      const isHead = /^(Mandate|Cancellation|Assignment)$/.test(p.trim());
      if (!writePara(p, isHead)) break;
    }
  }, { minHeight: 140 });

  // Client initials bottom of page 2
  {
    const initials2Y = pageBottom() - FOOTER_H - 8;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Client Initials:', L, initials2Y, { width: 90 });
    doc.moveTo(L + 70, initials2Y + 10).lineTo(L + 170, initials2Y + 10).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
  }

  // Footer Page 2 (NO Agreement No)
  footer(2, false);

  // =========================
  // PAGE 3 — General Terms & Conditions
  // =========================
  await newPageWithHeader('Terms & Conditions', { subtitle: '', showLogo: false });

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

  // NOTE: "Support & Service Levels" lives on Page 1 now
  const sections = [
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
    if (!ok) break;
  }

  // Column divider (visual)
  doc.save();
  const midX = (L + COL_W) + (COL_GAP / 2);
  doc.moveTo(midX, colTop - 4).lineTo(midX, colBottom + 4).strokeColor('#F0F0F0').lineWidth(1).stroke();
  doc.restore();

  // Client initials bottom of page 3
  {
    const initials3Y = pageBottom() - FOOTER_H - 8;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text('Client Initials:', L, initials3Y, { width: 90 });
    doc.moveTo(L + 70, initials3Y + 10).lineTo(L + 170, initials3Y + 10).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
  }

  // Footer Page 3 (NO Agreement No)
  footer(3, false);

  // ---- finalize & return buffer ----
  doc.end();
  return await done;
}
