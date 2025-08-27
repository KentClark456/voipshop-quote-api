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
    // optional: pass the same structure you use for quotes/checkout to auto-populate services
    itemsMonthly = [],              // e.g. [{name, qty, unit, minutes?}]
    minutesIncluded = 0,            // global minutes fallback from checkout if needed

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

  // 1) Hard one-pager: prevent PDFKit from adding pages at all
  const doc = new PDFDocument({ size: 'A4', margin: 32 });
  const _realAddPage = doc.addPage.bind(doc);
  doc.addPage = function noAddPage() { return this; }; // clamp to one page

  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // 2) Header (safe: no async in pageAdded; we’re single-page anyway)
  let y = await drawLogoHeader(doc, {
    logoUrl: company?.logoUrl,
    align: 'right',
    title: 'Service Level Agreement',
    subtitle: company?.website || ''
  });
  y = Math.max(y, 70);

  // 3) Layout helpers
  const L = 40, R = doc.page.width - 40, W = R - L;
  const FOOTER_H = 26;
  const pageBottom = () => doc.page.height - doc.page.margins.bottom;
  const hasSpace = (need) => doc.y <= (pageBottom() - (need + FOOTER_H));

  const rule = (pad = 6) => {
    if (!hasSpace(pad + 2)) return;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(BORDER).lineWidth(1).stroke();
    y += pad;
  };
  const h  = (t) => {
    if (!hasSpace(16)) return;
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(t, L, y, { width: W });
    y = doc.y + 4;
  };
  const p  = (t, opts={}) => {
    const hgt = doc.heightOfString(String(t||''), { width: W, lineGap: 0.8, ...opts });
    if (!hasSpace(hgt + 4)) return;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(t, L, y, { width: W, lineGap: 0.8, ...opts });
    y = doc.y + 4; doc.fillColor(INK);
  };
  const kv = (k,v) => {
    if (!hasSpace(16)) return;
    const mid = L + W * 0.30;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(k, L, y, { width: mid - L - 6 });
    doc.font('Helvetica-Bold').fontSize(8).fillColor(INK).text(v || '—', mid, y, { width: R - mid });
    y = Math.max(doc.y, y) + 3.5;
  };
  const bullet = (txt) => {
    const est = 14 + doc.heightOfString(String(txt||''), { width: W - 18, lineGap: 0.6 });
    if (!hasSpace(est)) return;
    const bx = L + 9;
    doc.save();
    doc.circle(L + 3, y + 3.2, 1.1).fill('#6B7280');
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(txt, bx, y, { width: R - bx, lineGap: 0.6 });
    doc.restore();
    y = doc.y + 3; doc.fillColor(INK);
  };

  // 4) Meta strip
  if (hasSpace(24)) {
    doc.save();
    doc.rect(L, y, W, 20).fill(BG);
    doc.restore();
    doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(9)
       .text(`Agreement No: ${slaNumber}`, L + 10, y + 6, { continued: true })
       .fillColor(MUTED).font('Helvetica').text(`  •  Effective: ${effectiveDateISO}`);
    y += 26;
  }

  // 5) Parties
  h('Parties');
  kv('Provider', `${company?.name || 'VoIP Shop'}${company?.reg ? ` | Reg ${company.reg}` : ''}${company?.vat ? ` | VAT ${company.vat}` : ''}`);
  kv('Contact', `${company?.phone || ''}${company?.email ? ` | ${company.email}`:''}${company?.website ? ` | ${company.website}`:''}`);
  kv('Address', company?.address || '');
  y += 1.5;
  kv('Customer', `${customer?.name || 'Customer'}${customer?.reg ? ` | Reg ${customer.reg}` : ''}${customer?.vat ? ` | VAT ${customer.vat}` : ''}`);
  kv('Contact', `${customer?.contact || ''}${customer?.phone ? ` | ${customer.phone}`:''}${customer?.email ? ` | ${customer.email}`:''}`);
  kv('Address', customer?.address || '');
  rule(8);

  // 6) Services Ordered — auto-populate from checkout monthly if not provided
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
    // cap rows to keep 1-page; show +N more
    const maxRows = 6;
    if (hasSpace(12)) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(INK)
        .text('Item', L, y, { width: 230 })
        .text('Qty', L + 240, y, { width: 40, align: 'right' })
        .text('Notes', L + 290, y, { width: R - (L + 290) });
      y += 10;
      if (hasSpace(6)) { doc.moveTo(L, y).lineTo(R, y).strokeColor('#D1D5DB').stroke(); y += 5; }
    }
    for (let i = 0; i < Math.min(svc.length, maxRows); i++) {
      const { name, qty, unit, note } = svc[i];
      const need = 12;
      if (!hasSpace(need)) break;
      doc.font('Helvetica').fontSize(8).fillColor(MUTED)
        .text(name || '', L, y, { width: 230 })
        .text(qty != null ? `${qty}${unit ? ' ' + unit : ''}` : '—', L + 240, y, { width: 40, align: 'right' })
        .text(note || '', L + 290, y, { width: R - (L + 290) });
      y += 12;
    }
    const remaining = Math.max(0, svc.length - maxRows);
    if (remaining > 0 && hasSpace(10)) {
      doc.font('Helvetica-Oblique').fontSize(8).fillColor(MUTED).text(`+${remaining} more item(s)`, L, y);
      y += 10;
    }
  }
  rule(8);

  // 7) Fees & Billing (concise)
  const ex  = Number.isFinite(monthlyExVat) ? monthlyExVat : 0;
  const inc = Number.isFinite(monthlyInclVat) ? monthlyInclVat
            : Math.round(ex * (1 + (Number(vatRate)||0)) * 100) / 100;

  h('Fees & Billing');
  bullet(`Monthly: R ${ex.toFixed(2)} ex VAT  •  R ${inc.toFixed(2)} incl VAT  •  VAT ${((Number(vatRate)||0)*100).toFixed(0)}%.`);
  bullet(`Scope: ${serviceDescription}. Once-off (install/hardware/porting) per signed quote.`);
  bullet('Billing: MRC in advance; usage in arrears (if applicable). Payment by debit order/EFT by due date.');
  bullet(`Term: Month-to-month; ${noticeDays}-day written notice to cancel.`);
  rule(8);

  // 8) Debit Order Mandate (CLEAN fill-in form; no huge grey block)
  h('Debit Order Mandate (Fill In)');
  // light card outline only; avoid big fills
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
    y += 18;
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
    y = sY + 12;
  }

  // outline the area subtly (stroke only—NO big fill)
  doc.save();
  doc.roundedRect(L, boxTop - 8, W, Math.max((y - boxTop) + 14, 120), 8).strokeColor(BORDER).lineWidth(1).stroke();
  // small pill header
  doc.roundedRect(L + 10, boxTop - 14, 120, 16, 8).fillColor(TEAL).fill();
  doc.fillColor('white').font('Helvetica-Bold').fontSize(8.5).text('Debit Order Mandate', L + 18, boxTop - 11);
  doc.restore();

  rule(8);

  // 9) Service Levels (super concise)
  h('Service Levels & Support');
  bullet('Hours: Mon–Fri 08:30–17:00 SAST. Support via WhatsApp +27 71 005 7691 & sales@voipshop.co.za.');
  bullet('P1 outage: response 1h, restore target 8h.  •  P2: response 4h, restore 1 business day.');
  bullet('P3 / MAC: response 1 business day, target 2–3 business days.  Onsite by arrangement; travel/after-hours may apply.');
  rule(6);

  // 10) Warranty, Liability & Compliance (ultra-brief)
  h('Warranty, Liability & Compliance');
  bullet('Devices: manufacturer warranty (≈12 months, return-to-base). Excludes surges/liquids/abuse/unauthorised firmware.');
  bullet('Service is best-effort; no guarantee of uninterrupted service. Liability capped at lesser of 3 months’ fees or R100,000; no indirect/consequential loss.');
  bullet('VoIP quality depends on ISP/carrier, local LAN/Wi-Fi & power; Customer to implement QoS/backup power for critical use.');
  bullet('Number porting timelines subject to donor carrier. Call recording must comply with POPIA; Customer manages notices/retention.');
  rule(6);

  // 11) General
  h('General');
  bullet('This SLA forms part of the overall agreement (quotes, orders, policies). Latest signed quote/order prevails on conflicts.');
  bullet('South African law; venue Johannesburg. Variations require written agreement by both parties. If any clause is unenforceable, the remainder stays in force.');
  rule(6);

  // 12) Acceptance
  if (hasSpace(58)) {
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
  }

  // 13) Footer (always fits—single line)
  const footerY = doc.page.height - 24;
  doc.font('Helvetica').fontSize(7).fillColor(MUTED)
     .text(`Agreement No: ${slaNumber} • Page ${doc.page.number}`, L, footerY, { width: W, align: 'right' });

  doc.end();
  return done;
}
