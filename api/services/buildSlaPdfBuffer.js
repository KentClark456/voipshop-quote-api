// services/buildSlaPdfBuffer.js
import PDFDocument from 'pdfkit';
import { drawLogoHeader } from '../../utils/pdf-branding.js';

export async function buildSlaPdfBuffer(params = {}) {
  const {
    company = {},
    customer = {},
    slaNumber = `SLA-${new Date().toISOString().slice(0,10).replace(/-/g,'')}`,
    effectiveDateISO = new Date().toISOString().slice(0,10),
    noticeDays = 30,

    // fees
    monthlyExVat = 0,
    monthlyInclVat = 0,
    vatRate = 0.15,

    // services can be passed directly (fallback will derive from checkout monthly items)
    services = [],
    itemsMonthly = [],              // e.g. [{name, qty, unit, minutes?}] where unit is unit price (number) when available
    minutesIncluded = 0,            // fallback

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

  // ---- Doc (force max 2 pages) ----
  const doc = new PDFDocument({ size: 'A4', margin: 32 });
  const _realAddPage = doc.addPage.bind(doc);
  let pageCount = 1;
  doc.addPage = function limitedAddPage() {
    if (pageCount >= 2) return this; // clamp to 2 pages
    pageCount += 1;
    return _realAddPage();
  };

  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // ---- Common layout helpers ----
  const L = 40, R = doc.page.width - 40, W = R - L;
  const FOOTER_H = 26;
  const pageBottom = () => doc.page.height - doc.page.margins.bottom;
  let y = doc.y;

  const hasSpace = (need) => doc.y <= (pageBottom() - (need + FOOTER_H));
  const moveY = (amt=0) => { y = (doc.y = (doc.y + amt)); };

  // ---------- Card helpers (NO pills, titles inside card) ----------
  const drawCard = (title, contentCb, options = {}) => {
    const {
      headerH = 18,     // title area inside the card
      minHeight = 72,
      gapAfter = 12,
      innerPad = 12
    } = options;

    const cardTop = y;
    const x0 = L;
    const w0 = W;

    // Title + content area
    const titleX = x0 + innerPad;
    const titleY = cardTop + 8;

    // Reserve space for header area, then render content
    const contentLeft = x0 + innerPad;
    const contentTop  = cardTop + headerH + 6;
    const contentW    = w0 - innerPad * 2;

    // We’ll render after we know height
    // 1) Draw title
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(title, titleX, titleY, { width: contentW });

    // 2) Render content
    doc.y = contentTop; y = contentTop;
    contentCb({ x: contentLeft, w: contentW });

    // 3) Compute height and draw the card
    const contentBottom = y + 10;
    const hCard = Math.max(minHeight, contentBottom - cardTop);

    doc.save();
    doc.roundedRect(x0, cardTop, w0, hCard, 10).strokeColor(BORDER).lineWidth(1).stroke();
    doc.restore();

    // 4) Cursor after card
    doc.y = cardTop + hCard + gapAfter; y = doc.y;
  };

  // 2-up (left/right) fields inside a single card with a vertical divider, NO pill
  const drawTwoUpCard = (title, leftCb, rightCb) => {
    const innerPad = 12;
    const headerH = 18;
    const colGap  = 18;

    const cardTop = y;
    const x0 = L, w0 = W;

    // Title
    const titleX = x0 + innerPad;
    const titleY = cardTop + 8;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(title, titleX, titleY, { width: w0 - innerPad * 2 });

    // Column geometry
    const innerLeft = x0 + innerPad;
    const innerTop  = cardTop + headerH + 6;
    const colsW     = w0 - innerPad * 2 - colGap;
    const colW      = colsW / 2;
    const leftX     = innerLeft;
    const rightX    = innerLeft + colW + colGap;

    let yLeft = innerTop;
    let yRight = innerTop;

    const lf = (label, preset = '', lineW = colW * 0.62) => {
      if (yLeft + 20 > pageBottom() - FOOTER_H - 10) return;
      const labelW = Math.min(150, Math.max(110, colW * 0.38));
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label, leftX, yLeft + 2, { width: labelW - 8 });
      const sx = leftX + labelW;
      const ly = yLeft + 12;
      doc.moveTo(sx, ly).lineTo(sx + lineW, ly).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
      if (preset) doc.font('Helvetica').fontSize(8).fillColor(INK).text(String(preset), sx + 2, yLeft + 4, { width: lineW - 6, ellipsis: true });
      yLeft += 18;
    };
    const rf = (label, preset = '', lineW = colW * 0.62) => {
      if (yRight + 20 > pageBottom() - FOOTER_H - 10) return;
      const labelW = Math.min(150, Math.max(110, colW * 0.38));
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label, rightX, yRight + 2, { width: labelW - 8 });
      const sx = rightX + labelW;
      const ly = yRight + 12;
      doc.moveTo(sx, ly).lineTo(sx + lineW, ly).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
      if (preset) doc.font('Helvetica').fontSize(8).fillColor(INK).text(String(preset), sx + 2, yRight + 4, { width: lineW - 6, ellipsis: true });
      yRight += 18;
    };

    // Column headings
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('Provider Details', leftX, innerTop - 2);
    yLeft += 12;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('Customer Details', rightX, innerTop - 2);
    yRight += 12;

    // Fill each column
    leftCb({ lf, leftX, colW });
    rightCb({ rf, rightX, colW });

    // Height and draw
    const contentBottom = Math.max(yLeft, yRight) + 8;
    const hCard = Math.max(96, (contentBottom - cardTop));

    doc.save();
    doc.roundedRect(x0, cardTop, w0, hCard, 10).strokeColor(BORDER).lineWidth(1).stroke();
    // Divider
    const midX = leftX + colW + (colGap / 2);
    doc.moveTo(midX, innerTop - 6).lineTo(midX, cardTop + hCard - 8).strokeColor('#EFEFEF').lineWidth(1).stroke();
    doc.restore();

    // Cursor after card
    doc.y = cardTop + hCard + 12; y = doc.y;
  };

  // ---- Header (Page 1) ----
  y = await drawLogoHeader(doc, {
    logoUrl: company?.logoUrl,
    align: 'right',
    title: 'Service Level Agreement',
    subtitle: company?.website || ''
  });
  y = Math.max(y, 70);
  doc.y = y;

  // ---- Meta strip
  if (hasSpace(24)) {
    doc.save();
    doc.rect(L, y, W, 20).fill(BG);
    doc.restore();
    doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(9)
      .text(`Agreement No: ${slaNumber}`, L + 10, y + 6, { continued: true })
      .fillColor(MUTED).font('Helvetica').text(`  •  Effective: ${effectiveDateISO}`);
    moveY(26);
  }

  // ✅ Parties — Details (Two-up in one card) — NO pills, tighter
  drawTwoUpCard('Parties — Details (Fill In)',
    ({ lf }) => {
      lf('Provider Name', company?.name || 'VoIP Shop');
      lf('VAT Number', company?.vat || '');
      lf('Phone', company?.phone || '');
      lf('Email', company?.email || '');
      lf('Website', company?.website || '');
      lf('Address', company?.address || '', 130);
    },
    ({ rf }) => {
      rf('Customer / Company', customer?.name || customer?.company || '');
      rf('Reg Number', customer?.reg || '');
      rf('VAT Number', customer?.vat || '');
      rf('Contact Person', customer?.contact || '');
      rf('Phone', customer?.phone || '');
      rf('Email', customer?.email || '');
      rf('Service Address', customer?.address || '', 130);
    }
  );

  // ---- Services Ordered — derive + pricing table
  const deriveServices = () => {
    // Prefer explicit services array if provided
    if (Array.isArray(services) && services.length) return services;
    if (!Array.isArray(itemsMonthly) || !itemsMonthly.length) return [];
    const globMin = Number(minutesIncluded || 0);
    return itemsMonthly.map(it => {
      const name = String(it?.name || '');
      const looksLikeCalls = /call|min(ute)?s?/i.test(name);
      const mins = Number(
        it?.minutes ??
        it?.minutesIncluded ??
        it?.includedMinutes ??
        0
      ) || (looksLikeCalls ? globMin : 0);

      // unit here is expected to be unit PRICE when present (from checkout collection)
      const unitPrice = Number(it?.unit);
      const qtyBase   = looksLikeCalls ? (mins || 0) : Number(it?.qty || 1);
      const qty       = Number.isFinite(qtyBase) && qtyBase > 0 ? qtyBase : 1;

      return {
        name,
        qty,
        unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
        note: looksLikeCalls && mins ? `Includes ${mins} minutes` : ''
      };
    });
  };
  const svc = deriveServices();

  drawCard('Services Ordered (Monthly)', ({ x, w }) => {
    // Header
    const cW = [ w * 0.52, w * 0.12, w * 0.16, w * 0.20 ]; // Description, Qty, Unit Price, Line Total
    const rx = [ x, x + cW[0], x + cW[0] + cW[1], x + cW[0] + cW[1] + cW[2] ];
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK);
    doc.text('Description', rx[0], y, { width: cW[0] });
    doc.text('Qty',         rx[1], y, { width: cW[1], align: 'right' });
    doc.text('Unit Price',  rx[2], y, { width: cW[2], align: 'right' });
    doc.text('Line Total',  rx[3], y, { width: cW[3], align: 'right' });
    moveY(10);
    doc.moveTo(x, y).lineTo(x + w, y).strokeColor('#D1D5DB').lineWidth(1).stroke();
    moveY(6);

    if (!svc.length) {
      doc.font('Helvetica').fontSize(8).fillColor(MUTED)
         .text('No monthly service lines were supplied. (Pass `services` OR `itemsMonthly` + `minutesIncluded`.)', x, y, { width: w });
      moveY(12);
      return;
    }

    doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    let subtotal = 0;
    const rowH = 12;
    const maxRows = 8;

    for (let i = 0; i < Math.min(svc.length, maxRows); i++) {
      const it = svc[i];
      const lineTotal = (Number(it.unitPrice) || 0) * (Number(it.qty) || 0);
      subtotal += Number.isFinite(lineTotal) ? lineTotal : 0;

      // row
      doc.text(it.name || '', rx[0], y, { width: cW[0] });
      doc.text(String(it.qty || 0), rx[1], y, { width: cW[1], align: 'right' });
      doc.text(it.unitPrice > 0 ? money(it.unitPrice) : '—', rx[2], y, { width: cW[2], align: 'right' });
      doc.text(money(lineTotal), rx[3], y, { width: cW[3], align: 'right' });
      moveY(rowH);

      if (it.note) {
        doc.font('Helvetica-Oblique').fillColor(MUTED)
           .text(it.note, rx[0], y - 2, { width: cW[0] });
        doc.font('Helvetica').fillColor(MUTED);
        moveY(rowH - 6);
      }
    }

    const remaining = Math.max(0, svc.length - maxRows);
    if (remaining > 0) {
      doc.font('Helvetica-Oblique').fontSize(8).fillColor(MUTED)
         .text(`+${remaining} more item(s) included in totals`, x, y, { width: w });
      moveY(10);
      doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    }

    // Totals (monthly)
    const vat = subtotal * Number(vatRate || 0);
    const total = subtotal + vat;

    moveY(4);
    doc.moveTo(x, y).lineTo(x + w, y).strokeColor('#E5E7EB').lineWidth(1).stroke();
    moveY(6);

    const labelW = 110;
    const valW   = 110;
    const valX   = x + w - valW;
    const labX   = valX - labelW - 8;

    const line = (label, val, bold=false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(bold ? INK : MUTED)
         .text(label, labX, y, { width: labelW, align: 'right' });
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(INK)
         .text(money(val), valX, y, { width: valW, align: 'right' });
      moveY(14);
    };

    line('Monthly Subtotal (ex VAT)', subtotal);
    line(`VAT (${Math.round(Number(vatRate||0)*100)}%)`, vat);
    line('Monthly Total (incl VAT)', total, true);
  }, { minHeight: 120 });

  // ---- Fees & Billing (more compact)
  const ex  = Number.isFinite(monthlyExVat) ? monthlyExVat : 0;
  const inc = Number.isFinite(monthlyInclVat) ? monthlyInclVat
            : Math.round(ex * (1 + (Number(vatRate)||0)) * 100) / 100;

  drawCard('Fees & Billing', ({ x, w }) => {
    const one = (t) => {
      const est = doc.heightOfString(String(t||''), { width: w - 12, lineGap: 0.3 }); // tighter
      if (!hasSpace(est + 6)) return;
      doc.circle(x + 2.5, y + 3.0, 1.0).fill('#6B7280');
      doc.fillColor(MUTED).font('Helvetica').fontSize(8)
         .text(t, x + 8, y, { width: w - 12, lineGap: 0.3 });
      moveY(est + 3);
      doc.fillColor(INK);
    };
    one(`Monthly: ${money(ex)} ex VAT  •  ${money(inc)} incl VAT  •  VAT ${((Number(vatRate)||0)*100).toFixed(0)}%.`);
    one(`Scope: ${serviceDescription}. Once-off (install/hardware/porting) per signed quote.`);
    one('First invoice is payable upfront before activation. Thereafter, billed monthly in arrears (end of month).');
    one('Payment via debit order or EFT by due date; late payment may suspend service and accrues interest at prime + 6%.');
    one(`Term: Month-to-month; ${noticeDays}-day written notice to cancel.`);
  }, { minHeight: 88 });

  // ---- Debit Order Mandate (spacious, signature inside; initials AFTER card)
  drawCard('Debit Order Mandate (Fill In)', (box) => {
    const labelW = 140;
    const fill = (label, preset = '', width = box.w - labelW - 22) => {
      if (!hasSpace(20)) return;
      const lx = box.x + labelW;
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label, box.x, y + 2, { width: labelW - 10 });
      const ly = y + 12;
      doc.moveTo(lx, ly).lineTo(lx + width, ly).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
      if (preset) {
        doc.font('Helvetica').fontSize(8).fillColor(INK).text(String(preset), lx + 2, y + 4, { width: width - 4, ellipsis: true });
      }
      moveY(18);
    };
    fill('Account Holder', debitOrder?.accountName || '');
    fill('Bank', debitOrder?.bank || '');
    fill('Branch Code', debitOrder?.branchCode || '');
    fill('Account Number', debitOrder?.accountNumber || '');
    fill('Account Type (e.g., Cheque/Savings)', debitOrder?.accountType || '');
    fill('Collection Day (1–31)', debitOrder?.dayOfMonth != null ? `Day ${debitOrder.dayOfMonth}` : '', 160);
    fill('Mandate Date (YYYY-MM-DD)', debitOrder?.mandateDateISO || '', 200);

    // Signature + Date ONLY (no initials here)
    if (hasSpace(30)) {
      const colW = (box.w - 20) / 2;
      const sx1 = box.x, sx2 = box.x + colW + 20;
      const sY = y + 8;
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Customer Signature', sx1, sY - 12);
      doc.moveTo(sx1, sY).lineTo(sx1 + colW, sY).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
      doc.text('Date', sx2, sY - 12);
      doc.moveTo(sx2, sY).lineTo(sx2 + colW, sY).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
      y = sY + 14; doc.y = y;
    }
  }, { minHeight: 150 });

  // ---- Client Initials (AFTER the debit order card, at bottom of page 1)
  const initialsY = pageBottom() - FOOTER_H - 10;
  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
     .text('Client Initials:', L, initialsY, { width: 90 });
  doc.moveTo(L + 70, initialsY + 10).lineTo(L + 170, initialsY + 10).strokeColor('#9CA3AF').lineWidth(0.8).stroke();

  // ---- Footer Page 1
  const footer1Y = doc.page.height - 24;
  doc.font('Helvetica').fontSize(7).fillColor(MUTED)
     .text(`Agreement No: ${slaNumber} • Page 1 of 2`, L, footer1Y, { width: W, align: 'right' });

  // =========================
  // PAGE 2 — Terms & Conditions (strict 2-column layout)
  // =========================
  doc.addPage();
  y = await drawLogoHeader(doc, {
    logoUrl: company?.logoUrl,
    align: 'right',
    title: 'Terms & Conditions',
    subtitle: company?.website || ''
  });
  y = Math.max(y, 70);
  doc.y = y;

  // Column geometry
  const COL_GAP = 22;
  const COL_W = (W - COL_GAP) / 2;
  const colX = (i) => L + i * (COL_W + COL_GAP);
  const colTop = y;
  const colBottom = pageBottom() - FOOTER_H - 12;

  // Maintain y per column, prevent overlap
  let colYs = [colTop, colTop]; // left, right

  const tryWriteSection = (colIndex, title, bullets) => {
    let x = colX(colIndex);
    let yCursor = colYs[colIndex];

    const headerH = 16; // header + underline + gap
    const bulletsH = bullets.reduce((acc, t) => {
      const h = 12 + doc.heightOfString(String(t||''), { width: COL_W - 14, lineGap: 0.5 });
      return acc + h + 6;
    }, 0);

    const needed = headerH + bulletsH + 6;
    if (yCursor + needed > colBottom) return false;

    // Header
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(title, x, yCursor, { width: COL_W });
    doc.moveTo(x, doc.y + 2).lineTo(x + COL_W, doc.y + 2).strokeColor(BORDER).lineWidth(1).stroke();
    yCursor = doc.y + 8;

    // Bullets
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

  // Content packs (added two new ones before General)
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
        'First invoice payable upfront before activation. Thereafter billed monthly in arrears (end of month).',
        'Payment by debit order or EFT by due date; late payments may suspend service.',
        'Interest on overdue amounts accrues at prime + 6%.',
        'Prices exclude VAT unless stated otherwise.',
        'Usage/call charges (where applicable) are billed in arrears.'
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
    // NEW 1
    {
      title: 'Data Protection (POPIA)',
      bullets: [
        'Both parties shall process personal information in compliance with POPIA.',
        'Where call recording is enabled, Customer must ensure lawful basis, appropriate notices to staff/callers, and retention/deletion policies.',
        'Customer is responsible for limiting access to recordings and ensuring secure storage of exported data.',
        'Any suspected breach must be reported without undue delay and cooperatively mitigated.'
      ]
    },
    // NEW 2
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

  // Place sections in columns without overlap
  for (const sec of sections) {
    const ok = placeSection(sec.title, sec.bullets);
    if (!ok) break; // no more room on page 2
  }

  // Column divider (visual)
  doc.save();
  const midX = colX(0) + COL_W + (COL_GAP / 2);
  doc.moveTo(midX, colTop - 4).lineTo(midX, colBottom + 4).strokeColor('#F0F0F0').lineWidth(1).stroke();
  doc.restore();

  // ---- Client Initials (bottom of page 2)
  const initials2Y = pageBottom() - FOOTER_H - 8;
  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
     .text('Client Initials:', L, initials2Y, { width: 90 });
  doc.moveTo(L + 70, initials2Y + 10).lineTo(L + 170, initials2Y + 10).strokeColor('#9CA3AF').lineWidth(0.8).stroke();

  // ---- Footer Page 2
  const footer2Y = doc.page.height - 24;
  doc.font('Helvetica').fontSize(7).fillColor(MUTED)
     .text(`Agreement No: ${slaNumber} • Page 2 of 2`, L, footer2Y, { width: W, align: 'right' });

  doc.end();
  return done;
}
