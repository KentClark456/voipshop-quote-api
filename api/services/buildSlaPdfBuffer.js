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
    itemsMonthly = [],              // e.g. [{name, qty, unit, minutes?}]
    minutesIncluded = 0,            // fallback

    debitOrder = {},
    serviceDescription = 'Hosted PBX incl. porting, provisioning & remote support'
  } = params;

  // ---- Palette ----
  const INK   = '#111827';
  const MUTED = '#4B5563';
  const BG    = '#F5F5F7';
  const BORDER= '#E5E7EB';
  const BLUE  = '#0B63E6';
  const TEAL  = '#0E5B52';

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

  const rule = (pad = 6) => {
    if (!hasSpace(pad + 2)) return;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(BORDER).lineWidth(1).stroke();
    moveY(pad);
  };
  const h  = (t) => {
    if (!hasSpace(16)) return;
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(t, L, y, { width: W });
    moveY(4);
  };
  const p  = (t, opts={}) => {
    const hgt = doc.heightOfString(String(t||''), { width: W, lineGap: 0.8, ...opts });
    if (!hasSpace(hgt + 4)) return;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(t, L, y, { width: W, lineGap: 0.8, ...opts });
    moveY(4); doc.fillColor(INK);
  };
  const kv = (k,v) => {
    if (!hasSpace(16)) return;
    const mid = L + W * 0.30;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(k, L, y, { width: mid - L - 6 });
    doc.font('Helvetica-Bold').fontSize(8).fillColor(INK).text(v || '—', mid, y, { width: R - mid });
    moveY(3.5);
  };
  const bullet = (txt) => {
    const est = 14 + doc.heightOfString(String(txt||''), { width: W - 18, lineGap: 0.6 });
    if (!hasSpace(est)) return;
    const bx = L + 9;
    doc.save();
    doc.circle(L + 3, y + 3.2, 1.1).fill('#6B7280');
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(txt, bx, y, { width: R - bx, lineGap: 0.6 });
    doc.restore();
    moveY(doc.heightOfString(String(txt||''), { width: R - bx, lineGap: 0.6 }) + 3);
    doc.fillColor(INK);
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

  // ---- Parties (Provider without reg number)
  h('Parties');
  // Provider line: omit reg number, allow VAT if given
  kv('Provider', `${company?.name || 'VoIP Shop'}${company?.vat ? ` | VAT ${company.vat}` : ''}`);
  kv('Contact', `${company?.phone || ''}${company?.email ? ` | ${company.email}`:''}${company?.website ? ` | ${company.website}`:''}`);
  kv('Address', company?.address || '');
  moveY(1.5);
  kv('Customer', `${customer?.name || 'Customer'}${customer?.reg ? ` | Reg ${customer.reg}` : ''}${customer?.vat ? ` | VAT ${customer.vat}` : ''}`);
  kv('Contact', `${customer?.contact || ''}${customer?.phone ? ` | ${customer.phone}`:''}${customer?.email ? ` | ${customer.email}`:''}`);
  kv('Address', customer?.address || '');
  rule(8);

  // ---- Services Ordered — derive if not provided
  const deriveServices = () => {
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
      return {
        name,
        qty: looksLikeCalls ? (mins || 0) : Number(it?.qty || 1),
        unit: looksLikeCalls ? 'minutes' : (it?.unit ? 'ea' : ''),
        note: looksLikeCalls && mins ? `Includes ${mins} minutes` : ''
      };
    });
  };
  const svc = deriveServices();

  h('Services Ordered (Monthly)');
  if (!svc.length) {
    p('No monthly service lines were supplied. (Pass `services` OR `itemsMonthly` + `minutesIncluded`.)');
  } else {
    const maxRows = 6; // cap to keep page 1 tidy
    if (hasSpace(12)) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(INK)
        .text('Item', L, y, { width: 230 })
        .text('Qty', L + 240, y, { width: 40, align: 'right' })
        .text('Notes', L + 290, y, { width: R - (L + 290) });
      moveY(10);
      if (hasSpace(6)) { doc.moveTo(L, y).lineTo(R, y).strokeColor('#D1D5DB').stroke(); moveY(5); }
    }
    for (let i = 0; i < Math.min(svc.length, maxRows); i++) {
      const { name, qty, unit, note } = svc[i];
      const need = 12;
      if (!hasSpace(need)) break;
      doc.font('Helvetica').fontSize(8).fillColor(MUTED)
        .text(name || '', L, y, { width: 230 })
        .text(qty != null ? `${qty}${unit ? ' ' + unit : ''}` : '—', L + 240, y, { width: 40, align: 'right' })
        .text(note || '', L + 290, y, { width: R - (L + 290) });
      moveY(12);
    }
    const remaining = Math.max(0, svc.length - maxRows);
    if (remaining > 0 && hasSpace(10)) {
      doc.font('Helvetica-Oblique').fontSize(8).fillColor(MUTED).text(`+${remaining} more item(s)`, L, y);
      moveY(10);
    }
  }
  rule(8);

  // ---- Fees & Billing (policy: first invoice upfront, thereafter in arrears)
  const ex  = Number.isFinite(monthlyExVat) ? monthlyExVat : 0;
  const inc = Number.isFinite(monthlyInclVat) ? monthlyInclVat
            : Math.round(ex * (1 + (Number(vatRate)||0)) * 100) / 100;

  h('Fees & Billing');
  bullet(`Monthly: R ${ex.toFixed(2)} ex VAT  •  R ${inc.toFixed(2)} incl VAT  •  VAT ${((Number(vatRate)||0)*100).toFixed(0)}%.`);
  bullet(`Scope: ${serviceDescription}. Once-off (install/hardware/porting) per signed quote.`);
  // NEW policy:
  bullet('Billing: First invoice is payable upfront before activation. Thereafter, services are billed monthly in arrears (end of each month).');
  bullet('Payment via debit order or EFT by due date; late payment may suspend service and accrues interest at prime + 6%.');
  bullet(`Term: Month-to-month; ${noticeDays}-day written notice to cancel.`);
  rule(8);

  // ---- Debit Order Mandate (fill-in)
  h('Debit Order Mandate (Fill In)');
  const boxTop = y;
  const labelW = 140;
  const line = (label, preset = '', width = W - labelW - 22) => {
    if (!hasSpace(20)) return;
    const lx = L + labelW;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label, L, y + 2, { width: labelW - 10 });
    const ly = y + 12;
    doc.moveTo(lx, ly).lineTo(lx + width, ly).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
    if (preset) {
      doc.font('Helvetica').fontSize(8).fillColor(INK).text(String(preset), lx + 2, y + 4, { width: width - 4, ellipsis: true });
    }
    moveY(18);
  };
  line('Account Holder', debitOrder?.accountName || '');
  line('Bank', debitOrder?.bank || '');
  line('Branch Code', debitOrder?.branchCode || '');
  line('Account Number', debitOrder?.accountNumber || '');
  line('Account Type (e.g., Cheque/Savings)', debitOrder?.accountType || '');
  line('Collection Day (1–31)', debitOrder?.dayOfMonth != null ? `Day ${debitOrder.dayOfMonth}` : '', 160);
  line('Mandate Date (YYYY-MM-DD)', debitOrder?.mandateDateISO || '', 200);

  // signatures inline
  if (hasSpace(26)) {
    const sY = y + 6;
    const colW = (W - 20) / 2;
    const sx1 = L, sx2 = L + colW + 20;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Customer Signature', sx1, sY - 12);
    doc.moveTo(sx1, sY).lineTo(sx1 + colW, sY).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
    doc.text('Date', sx2, sY - 12);
    doc.moveTo(sx2, sY).lineTo(sx2 + colW, sY).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
    y = sY + 12; doc.y = y;
  }

  // outline card + header pill
  doc.save();
  doc.roundedRect(L, boxTop - 8, W, Math.max((y - boxTop) + 14, 120), 8).strokeColor(BORDER).lineWidth(1).stroke();
  doc.roundedRect(L + 10, boxTop - 14, 120, 16, 8).fillColor(TEAL).fill();
  doc.fillColor('white').font('Helvetica-Bold').fontSize(8.5).text('Debit Order Mandate', L + 18, boxTop - 11);
  doc.restore();

  // ---- Client Initials (bottom of page 1)
  const initialsY = pageBottom() - FOOTER_H - 10;
  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
     .text('Client Initials:', L, initialsY, { width: 90 });
  doc.moveTo(L + 70, initialsY + 10).lineTo(L + 170, initialsY + 10).strokeColor('#9CA3AF').lineWidth(0.8).stroke();

  // ---- Footer Page 1
  const footer1Y = doc.page.height - 24;
  doc.font('Helvetica').fontSize(7).fillColor(MUTED)
     .text(`Agreement No: ${slaNumber} • Page 1 of 2`, L, footer1Y, { width: W, align: 'right' });

  // =========================
  // PAGE 2 — Terms & Conditions (2-column layout to ensure fit)
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

  // Column helpers
  const COL_GAP = 22;
  const COL_W = (W - COL_GAP) / 2;
  const colX = (i) => L + i * (COL_W + COL_GAP);
  const colTop = y;
  const colBottom = pageBottom() - FOOTER_H - 6;

  const writeSection = (x, title, bullets) => {
    doc.save();
    doc.text('', x, doc.y); // move to column x
    const startY = doc.y;
    // header
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK)
      .text(title, x, doc.y, { width: COL_W });
    doc.moveTo(x, doc.y + 2).lineTo(x + COL_W, doc.y + 2).strokeColor(BORDER).lineWidth(1).stroke();
    moveToY(doc.y + 8);

    // bullets
    for (const t of bullets) {
      const est = 12 + doc.heightOfString(String(t||''), { width: COL_W - 14, lineGap: 0.5 });
      if (doc.y + est > colBottom) break; // stop if it won’t fit
      const bx = x + 8;
      doc.circle(x + 2.5, doc.y + 3.2, 1.1).fill('#6B7280');
      doc.fillColor(MUTED).font('Helvetica').fontSize(7.8)
         .text(t, bx, doc.y, { width: COL_W - 12, lineGap: 0.5 });
      moveToY(doc.y + 6);
      doc.fillColor(INK);
    }
    doc.restore();

    function moveToY(val) { doc.y = val; y = val; }
  };

  // set column 1 start
  doc.y = colTop; y = colTop;

  // Content packs (tight, but comprehensive)
  const sec1 = {
    title: 'Support & Service Levels',
    bullets: [
      'Remote support included at no charge.',
      'On-site support by arrangement; call-out fee R450 per visit (travel/after-hours may apply).',
      'Hours: Mon–Fri 08:30–17:00 SAST; WhatsApp & email support available.',
      'Fault priority targets: P1 outage—response 1h, restore 8h; P2—response 4h, restore 1 business day; P3/MAC—response 1 business day, target 2–3 business days.',
      'Service is best-effort and may be impacted by external providers (ISP/carrier), local network quality, Wi-Fi, or power.'
    ]
  };
  const sec2 = {
    title: 'Fees, Billing & Payments',
    bullets: [
      'First invoice payable upfront before activation. Thereafter billed monthly in arrears (end of month).',
      'Payment by debit order or EFT by due date; late payments may suspend service.',
      'Interest on overdue amounts accrues at prime + 6%.',
      'Prices exclude VAT unless stated otherwise.',
      'Usage/call charges (where applicable) are billed in arrears.'
    ]
  };
  const sec3 = {
    title: 'Customer Responsibilities',
    bullets: [
      'Provide stable power, Internet, and site access for installation/support.',
      'Maintain LAN/Wi-Fi security; prevent misuse or fraud.',
      'Use equipment/services lawfully; comply with POPIA for call recording and notices to employees/customers.',
      'Remain liable for all charges incurred on the account, whether authorised or unauthorised.',
      'Implement QoS/backup power for critical operations (recommended).'
    ]
  };
  const sec4 = {
    title: 'Equipment & Warranty',
    bullets: [
      'Hardware sold once-off; ownership passes to Customer upon payment.',
      'Manufacturer warranties (typically 12 months, return-to-base) apply; excludes surges/liquids/abuse/unauthorised firmware.',
      'Loan devices may be offered at VoIP Shop’s discretion and current pricing.',
      'Number porting timelines subject to donor carrier processes.'
    ]
  };
  const sec5 = {
    title: 'Liability & Force Majeure',
    bullets: [
      'No liability for indirect, consequential, or special damages, including loss of profit or business.',
      'Liability cap: the lesser of 3 months’ service fees or R100,000.',
      'Not liable for outages/delays due to third-party networks, power failures, or force majeure (e.g., load-shedding, strikes, disasters).'
    ]
  };
  const sec6 = {
    title: 'Term, Suspension & Termination',
    bullets: [
      `Month-to-month term; either party may cancel on ${noticeDays} days’ written notice.`,
      'Non-payment may lead to suspension until all arrears are settled.',
      'Upon termination, all unpaid fees become immediately due.'
    ]
  };
  const sec7 = {
    title: 'General',
    bullets: [
      'This SLA forms part of the overall agreement (signed quotes/orders/policies). If conflicts arise, the latest signed quote/order prevails for pricing/line items.',
      'Changes to this SLA require written agreement by both parties.',
      'Governing law: South Africa; venue: Johannesburg.',
      'If any clause is unenforceable, the remainder remains in force.'
    ]
  };

  // Column 1
  let col = 0;
  const sections = [sec1, sec2, sec3, sec4, sec5, sec6, sec7];
  doc.font('Helvetica').fontSize(7.8);
  for (let i = 0; i < sections.length; i++) {
    const x = colX(col);
    // if next section won't reasonably fit, switch to next column
    if (doc.y > colTop && doc.y + 60 > colBottom) { col += 1; doc.y = colTop; }
    writeSection(x, sections[i].title, sections[i].bullets);
    // small gap between sections
    if (doc.y + 8 <= colBottom) { doc.y += 6; y = doc.y; }
    // if we filled column, move to next
    if (doc.y + 40 > colBottom && col === 0) { col = 1; doc.y = colTop; y = doc.y; }
  }

  // Column dividers (subtle)
  doc.save();
  const midX = colX(0) + COL_W + (COL_GAP / 2);
  doc.moveTo(midX, colTop - 4).lineTo(midX, colBottom + 4).strokeColor('#F0F0F0').lineWidth(1).stroke();
  doc.restore();

  // ---- Footer Page 2
  const footer2Y = doc.page.height - 24;
  doc.font('Helvetica').fontSize(7).fillColor(MUTED)
     .text(`Agreement No: ${slaNumber} • Page 2 of 2`, L, footer2Y, { width: W, align: 'right' });

  doc.end();
  return done;
}
