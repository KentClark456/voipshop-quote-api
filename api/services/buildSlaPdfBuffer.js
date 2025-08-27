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

    monthlyExVat = 0,
    monthlyInclVat = 0,
    vatRate = 0.15,

    services = [],
    debitOrder = {},
    serviceDescription = 'Hosted PBX incl. porting, provisioning & remote support'
  } = params;

  // ---- Palette (Apple-ish) ----
  const INK   = '#111827';
  const MUTED = '#4B5563';
  const BG    = '#F5F5F7';
  const BORDER= '#E5E7EB';
  const BLUE  = '#0B63E6';
  const TEAL  = '#0E5B52';

  // Slightly tighter margin to bias a one-pager
  const doc = new PDFDocument({ size: 'A4', margin: 32 });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // Header (logo + title)
  let y = await drawLogoHeader(doc, {
    logoUrl: company?.logoUrl,
    align: 'right',
    title: 'Service Level Agreement',
    subtitle: company?.website || ''
  });

  doc.on('pageAdded', async () => {
    await drawLogoHeader(doc, {
      logoUrl: company?.logoUrl,
      align: 'right',
      title: 'Service Level Agreement',
      subtitle: company?.website || ''
    });
    y = Math.max(doc.y, 74);
  });

  // Layout helpers
  const L = 40, R = doc.page.width - 40, W = R - L;
  const rule = (pad = 6) => { doc.moveTo(L, y).lineTo(R, y).strokeColor(BORDER).lineWidth(1).stroke(); y += pad; };
  const h  = (t) => { doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(t, L, y, { width: W }); y = doc.y + 4; };
  const p  = (t, opts={}) => {
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(t, L, y, { width: W, lineGap: 0.8, ...opts });
    y = doc.y + 4; doc.fillColor(INK);
  };
  const kv = (k,v) => {
    const mid = L + W * 0.30;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(k, L, y, { width: mid - L - 6 });
    doc.font('Helvetica-Bold').fontSize(8).fillColor(INK).text(v || '—', mid, y, { width: R - mid });
    y = Math.max(doc.y, y) + 3.5;
  };
  const bullet = (txt) => {
    const bx = L + 9;
    doc.circle(L + 3, y + 3.2, 1.2).fill('#6B7280');
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(txt, bx, y, { width: R - bx, lineGap: 0.6 });
    y = doc.y + 3; doc.fillColor(INK);
  };
  const ensureSpace = (min = 80) => { if (y > doc.page.height - min) doc.addPage(); };

  // Subtle top badge strip
  doc.rect(L, y, W, 20).fillOpacity(1).fill(BG);
  doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(9)
     .text(`Agreement No: ${slaNumber}`, L + 10, y + 6, { continued: true })
     .fillColor(MUTED).font('Helvetica').text(`  •  Effective: ${effectiveDateISO}`);
  doc.fillOpacity(1);
  y += 26;

  // Parties / Client Info (concise)
  h('Parties');
  kv('Provider', `${company?.name || 'VoIP Shop'}${company?.reg ? ` | Reg ${company.reg}` : ''}${company?.vat ? ` | VAT ${company.vat}` : ''}`);
  kv('Contact', `${company?.phone || ''}${company?.email ? ` | ${company.email}`:''}${company?.website ? ` | ${company.website}`:''}`);
  kv('Address', company?.address || '');
  y += 1.5;
  kv('Customer', `${customer?.name || 'Customer'}${customer?.reg ? ` | Reg ${customer.reg}` : ''}${customer?.vat ? ` | VAT ${customer.vat}` : ''}`);
  kv('Contact', `${customer?.contact || ''}${customer?.phone ? ` | ${customer.phone}`:''}${customer?.email ? ` | ${customer.email}`:''}`);
  kv('Address', customer?.address || '');
  rule(8);

  // Services Ordered (compressed, with "+N more" if needed)
  ensureSpace();
  h('Services Ordered');
  if (!services?.length) {
    p('No monthly service lines were supplied from Checkout.');
  } else {
    const maxRows = 6; // keep it tight for one-pager
    doc.font('Helvetica-Bold').fontSize(8).fillColor(INK)
      .text('Item', L, y, { width: 230 })
      .text('Qty', L + 240, y, { width: 40, align: 'right' })
      .text('Notes', L + 290, y, { width: R - (L + 290) });
    y += 10;
    doc.moveTo(L, y).lineTo(R, y).strokeColor('#D1D5DB').stroke(); y += 5;

    services.slice(0, maxRows).forEach(({ name, qty, unit, note }) => {
      ensureSpace(90);
      doc.font('Helvetica').fontSize(8).fillColor(MUTED)
        .text(name || '', L, y, { width: 230 })
        .text(qty != null ? `${qty}${unit ? ' ' + unit : ''}` : '—', L + 240, y, { width: 40, align: 'right' })
        .text(note || '', L + 290, y, { width: R - (L + 290) });
      y += 12;
    });

    const remaining = Math.max(0, services.length - maxRows);
    if (remaining > 0) {
      doc.font('Helvetica-Oblique').fontSize(8).fillColor(MUTED)
         .text(`+${remaining} more item(s)`, L, y); y += 10;
    }
  }
  rule(8);

  // Fees (very concise)
  ensureSpace();
  const ex  = Number.isFinite(monthlyExVat) ? monthlyExVat : 0;
  const inc = Number.isFinite(monthlyInclVat) ? monthlyInclVat
            : Math.round(ex * (1 + (Number(vatRate)||0)) * 100) / 100;

  h('Fees & Billing');
  bullet(`Monthly: R ${ex.toFixed(2)} ex VAT  •  R ${inc.toFixed(2)} incl VAT  •  VAT ${((Number(vatRate)||0)*100).toFixed(0)}%.`);
  bullet(`Scope: ${serviceDescription}. Once-off (install/hardware/porting) per signed quote.`);
  bullet('Billing: MRC in advance; usage in arrears (if applicable). Payment by debit order/EFT by due date.');
  bullet(`Term: Month-to-month; ${noticeDays}-day written notice to cancel.`);
  rule(8);

  // Debit Order (boxed, writable lines)
  ensureSpace();
  const boxTop = y;
  const boxPad = 10;
  const boxHMin = 132; // target height for visible “form”
  h('Debit Order Mandate (Fill In)');
  const labelW = 120;
  const line = (label, width = W - labelW - 20) => {
    const lx = L + labelW;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label, L, y + 2, { width: labelW - 8 });
    // draw a clean writing line
    const ly = y + 12;
    doc.moveTo(lx, ly).lineTo(lx + width, ly).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
    y += 18;
  };

  // light card background
  const afterHeaderY = y;
  y += 2;
  line('Account Holder');
  line('Bank');
  line('Branch Code');
  line('Account Number');
  line('Account Type (e.g., Cheque/Savings)');
  line('Collection Day (1–31)', 160);
  line('Mandate Date (YYYY-MM-DD)', 200);
  // signature lines side by side
  const sigY = y + 8;
  const colW = (W - 20) / 2;
  const sx1 = L, sx2 = L + colW + 20;
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Customer Signature', sx1, sigY - 12);
  doc.moveTo(sx1, sigY).lineTo(sx1 + colW, sigY).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
  doc.text('Date', sx2, sigY - 12);
  doc.moveTo(sx2, sigY).lineTo(sx2 + colW, sigY).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
  y = sigY + 14;

  // draw the box behind the fields (after content so it sits “under” the text)
  doc.save();
  doc.rect(L, boxTop - 4, W, Math.max((y - boxTop) + 6, boxHMin))
     .fillOpacity(1).fill(BG);
  doc.restore();

  // reprint the small header over the box, with an accent pill
  doc.save();
  doc.roundedRect(L + 10, boxTop - 10, 110, 16, 8).fillOpacity(1).fill(TEAL);
  doc.fillColor('white').font('Helvetica-Bold').fontSize(8.5)
     .text('Debit Order Mandate', L + 18, boxTop - 7);
  doc.restore();

  // Service Levels (super concise, two columns)
  ensureSpace();
  h('Service Levels & Support');
  const colW2 = (W - 16) / 2;
  const yStartCols = y;
  // left column
  let yL = yStartCols, yR = yStartCols;
  const bulletAt = (txt, left = true) => {
    const xBase = left ? L : (L + colW2 + 16);
    const localY = left ? yL : yR;
    doc.circle(xBase + 3, localY + 3.2, 1.1).fill('#6B7280');
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.9)
       .text(txt, xBase + 9, localY, { width: colW2 - 9, lineGap: 0.5 });
    const ny = doc.y + 2.5;
    if (left) yL = ny; else yR = ny;
    doc.fillColor(INK);
  };
  bulletAt('Hours: Mon–Fri 08:30–17:00 SAST. Support via WhatsApp +27 71 005 7691 & sales@voipshop.co.za.', true);
  bulletAt('P1 outage: response 1h, restore target 8h.', true);
  bulletAt('P2 major: response 4h, restore target 1 business day.', true);
  bulletAt('P3/MAC: response 1 business day, target 2–3 business days.', true);
  bulletAt('Onsite: next business day (metro) or by arrangement; travel/after-hours may apply.', true);

  bulletAt('Remote support included during business hours for covered services.', false);
  bulletAt('Onsite (metro): R450 excl. VAT per visit + time/materials (unless included).', false);
  bulletAt('After-hours/urgent by arrangement; premium rates may apply.', false);
  bulletAt('Customer to ensure stable internet, power, LAN QoS/PoE where required.', false);
  bulletAt('3rd-party ISP/power/LAN issues excluded from SLA restoration times.', false);

  y = Math.max(yL, yR) + 2;
  rule(8);

  // Warranty, Liability & Compliance (ultra-brief)
  ensureSpace();
  h('Warranty, Liability & Compliance');
  bullet('Devices carry manufacturer warranty (typically 12 months, return-to-base). Excludes damage from power surges, liquids, abuse, or unauthorised firmware.');
  bullet('Services are best-effort; no guarantee of uninterrupted service. Aggregate liability capped at lesser of 3 months’ fees or R100,000; excludes indirect/consequential loss.');
  bullet('VoIP quality depends on ISP/carrier, local LAN/Wi-Fi & power; Customer implements QoS & backup power for critical use.');
  bullet('Number porting subject to donor carrier timelines. Call recording (if enabled) must comply with POPIA; Customer handles notices and retention.');
  rule(8);

  // General (very compact)
  ensureSpace();
  h('General');
  bullet('This SLA forms part of the overall agreement (quotes, orders, policies). Latest signed quote/order prevails on conflicts.');
  bullet('South African law; venue Johannesburg. Variations require written agreement by both parties. If any clause is unenforceable, the remainder stays in force.');
  rule(8);

  // Acceptance (compact)
  ensureSpace();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('Acceptance & Signature', L, y);
  const colWsig = (W - 20) / 2;
  const sY = y + 16;

  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`${company?.name || 'VoIP Shop'} (Provider)`, L, sY - 10);
  doc.moveTo(L, sY + 14).lineTo(L + colWsig, sY + 14).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
  doc.text('Name & Signature', L, sY + 18);
  doc.moveTo(L, sY + 38).lineTo(L + colWsig * 0.55, sY + 38).strokeColor(BORDER).lineWidth(0.8).stroke();
  doc.text('Date', L + colWsig * 0.6, sY + 32);

  const CX = L + colWsig + 20;
  doc.text(`${customer?.name || 'Customer'} (Customer)`, CX, sY - 10);
  doc.moveTo(CX, sY + 14).lineTo(CX + colWsig, sY + 14).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
  doc.text('Name & Signature', CX, sY + 18);
  doc.moveTo(CX, sY + 38).lineTo(CX + colWsig * 0.55, sY + 38).strokeColor(BORDER).lineWidth(0.8).stroke();
  doc.text('Date', CX + colWsig * 0.6, sY + 32);

  y = sY + 48;

  // Footer
  const footerY = doc.page.height - 28;
  doc.font('Helvetica').fontSize(7).fillColor(MUTED)
     .text(`Agreement No: ${slaNumber} • Page ${doc.page.number}`, L, footerY, { width: W, align: 'right' });

  doc.end();
  return done;
}
