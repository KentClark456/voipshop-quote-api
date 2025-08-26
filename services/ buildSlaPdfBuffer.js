// services/buildSlaPdfBuffer.js
import PDFDocument from 'pdfkit';
import { drawLogoHeader } from '../utils/pdf-branding.js';

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
    serviceDescription = 'Hosted PBX (incl. porting, device provisioning, remote support)'
  } = params;

  const doc = new PDFDocument({ size: 'A4', margin: 36 });
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
    y = Math.max(doc.y, 78);
  });

  // Layout helpers
  const L = 42, R = doc.page.width - 42, W = R - L;
  const rule = (pad = 8) => { doc.moveTo(L, y).lineTo(R, y).strokeColor('#E5E7EB').lineWidth(1).stroke(); y += pad; };
  const h  = (t) => { doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text(t, L, y, { width: W }); y = doc.y + 6; };
  const p  = (t, opts={}) => { doc.font('Helvetica').fontSize(8.5).fillColor('#374151').text(t, L, y, { width: W, lineGap: 1.1, ...opts }); y = doc.y + 6; doc.fillColor('#111827'); };
  const kv = (k,v) => {
    const mid = L + W * 0.32;
    doc.font('Helvetica').fontSize(8.5).fillColor('#374151').text(k, L, y, { width: mid - L - 8 });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111827').text(v || '—', mid, y, { width: R - mid });
    y = Math.max(doc.y, y) + 4;
  };
  const bullet = (txt) => {
    const bx = L + 10;
    doc.circle(L + 3.5, y + 4, 1.5).fill('#6B7280');
    doc.fillColor('#374151').font('Helvetica').fontSize(8.5).text(txt, bx, y, { width: R - bx, lineGap: 1.05 });
    y = doc.y + 3.5; doc.fillColor('#111827');
  };
  const ensureSpace = (min = 90) => {
    if (y > doc.page.height - min) doc.addPage();
  };

  // Title + meta
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#111827').text('Service Level Agreement (SLA)', L, y);
  doc.font('Helvetica').fontSize(9).fillColor('#6B7280')
     .text(`Agreement No: ${slaNumber}    •    Effective: ${effectiveDateISO}`, L, y + 20);
  doc.fillColor('#111827'); y += 40; rule();

  // Parties / Client Info
  h('Parties & Client Information');
  kv('Provider', `${company?.name || 'VoIP Shop'}${company?.reg ? ` | Reg ${company.reg}` : ''}${company?.vat ? ` | VAT ${company.vat}` : ''}`);
  kv('Provider Contact', `${company?.phone || ''}${company?.email ? ` | ${company.email}`:''}${company?.website ? ` | ${company.website}`:''}`);
  kv('Provider Address', company?.address || '');
  y += 2;
  kv('Customer', `${customer?.name || 'Customer'}${customer?.reg ? ` | Reg ${customer.reg}` : ''}${customer?.vat ? ` | VAT ${customer.vat}` : ''}`);
  kv('Customer Contact', `${customer?.contact || ''}${customer?.phone ? ` | ${customer.phone}`:''}${customer?.email ? ` | ${customer.email}`:''}`);
  kv('Customer Address', customer?.address || '');
  rule();

  // Services Ordered
  ensureSpace();
  h('Services Ordered (from Checkout)');
  if (!services?.length) {
    p('No service lines supplied. (Ensure you pass `services` from the Checkout “Monthly” section.)');
  } else {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111827')
      .text('Item', L, y, { width: 210 })
      .text('Qty', L + 210, y, { width: 40, align: 'right' })
      .text('Notes', L + 260, y, { width: R - (L + 260) });
    y += 12;
    doc.moveTo(L, y).lineTo(R, y).strokeColor('#D1D5DB').stroke(); y += 6;

    services.forEach(({ name, qty, unit, note }) => {
      ensureSpace(110);
      doc.font('Helvetica').fontSize(8.5).fillColor('#374151')
        .text(name || '', L, y, { width: 210 })
        .text(qty != null ? `${qty}${unit ? ' ' + unit : ''}` : '—', L + 210, y, { width: 40, align: 'right' })
        .text(note || '', L + 260, y, { width: R - (L + 260) });
      y += 14;
    });
  }
  y += 2; rule();

  // Fees & Billing
  ensureSpace();
  const ex  = Number.isFinite(monthlyExVat) ? monthlyExVat : 0;
  const inc = Number.isFinite(monthlyInclVat) ? monthlyInclVat : Math.round(ex * (1 + (Number(vatRate)||0)) * 100) / 100;

  h('Fees & Billing');
  bullet(`Monthly Service Fee: R ${ex.toFixed(2)} (ex VAT), R ${inc.toFixed(2)} (incl VAT) at VAT rate ${((Number(vatRate)||0)*100).toFixed(0)}%.`);
  bullet(`Scope/Basis: ${serviceDescription}.`);
  bullet('Once-off charges (install/hardware/porting) as quoted; MRC billed in advance; usage billed in arrears where applicable.');
  bullet('Payment terms: Debit order or EFT on/before due date; non-payment may lead to suspension after notice.');
  bullet(`Term: Month-to-month; either party may cancel with ${noticeDays} days’ written notice.`);
  rule();

  // Debit Order Details
  ensureSpace();
  h('Debit Order Details (Mandate)');
  kv('Account Holder', debitOrder?.accountName || '');
  kv('Bank', `${debitOrder?.bank || ''}${debitOrder?.branchCode ? ` | Branch ${debitOrder.branchCode}` : ''}`);
  kv('Account No.', debitOrder?.accountNumber || '');
  kv('Account Type', debitOrder?.accountType || '');
  kv('Collection Day', debitOrder?.dayOfMonth != null ? `Day ${debitOrder.dayOfMonth} of each month` : '');
  kv('Mandate Date', debitOrder?.mandateDateISO || '');
  p('By signing, the Customer authorises the Provider (or its billing agent) to collect the monthly fees and any variable usage charges by debit order in accordance with this mandate. Any bank charges arising from returned debits may be recovered from the Customer.');
  rule();

  // SLAs & Support
  ensureSpace();
  h('Service Levels & Support');
  bullet('Business hours: Mon–Fri 08:30–17:00 SAST. Support via WhatsApp +27 71 005 7691 and email sales@voipshop.co.za.');
  bullet('P1 outage (complete service loss): response target 1 hour; restore target 8 hours.');
  bullet('P2 major impairment (degraded quality / multiple users): response target 4 hours; restore target 1 business day.');
  bullet('P3 minor / MAC (Moves, Adds & Changes): response target 1 business day; target 2–3 business days.');
  bullet('Onsite: next business day (metro) or by arrangement; travel/after-hours rates may apply.');
  rule();

  // Call-out Fees
  ensureSpace();
  h('Call-out Fees & After-hours');
  bullet('Remote support: included during business hours for covered services.');
  bullet('Onsite call-out (metro): R450 excl. VAT per visit plus time & materials (unless included in quote).');
  bullet('After-hours / urgent work: by arrangement; premium rates may apply.');
  rule();

  // Installation & Premises
  ensureSpace();
  h('Installation & Premises');
  bullet('Customer is responsible for providing stable internet, power, and LAN with suitable QoS and PoE where required.');
  bullet('Provider is not liable for delays/faults caused by third-party ISPs, carriers, power issues, or local network misconfiguration.');
  bullet('Where installation/cabling is performed, workmanship is warranted for 90 days; latent defects in premises cabling are excluded.');
  rule();

  // Hardware Warranty
  ensureSpace();
  h('Hardware Warranty');
  bullet('Manufacturer warranty applies to devices (typically 12 months, return-to-base unless otherwise specified).');
  bullet('Damage due to power surges, liquids, physical abuse, or unauthorised firmware is excluded.');
  rule();

  // Liability & VoIP Considerations
  ensureSpace();
  h('Liability & VoIP Considerations');
  bullet('Services are provided on a commercially reasonable efforts basis; uninterrupted service is not guaranteed.');
  bullet('To the extent permitted by law, Provider is not liable for indirect or consequential loss, including loss of revenue, profit, or business opportunities arising from outages or quality issues.');
  bullet('Aggregate liability is capped at the lesser of three (3) months of service fees or R100,000.');
  bullet('Customer acknowledges VoIP quality depends on third parties (ISP/carriers), local LAN/Wi-Fi, and power. The Customer will implement reasonable QoS and backup power for critical use.');
  rule();

  // Numbering, Porting & Compliance
  ensureSpace();
  h('Numbering, Porting & Compliance');
  bullet('Customer will review and approve porting forms and numbering plans. Porting lead times are subject to donor carrier processes.');
  bullet('Call recording (if enabled) must comply with POPIA and other laws; Customer is responsible for notices and retention policies.');
  rule();

  // General
  ensureSpace();
  h('General');
  bullet('This SLA forms part of the overall agreement including quotes, order forms, and policies. Latest signed quote/order prevails on conflicts.');
  bullet('South African law governs; venue Johannesburg. Variations require written agreement by both parties.');
  bullet('If any clause is found unenforceable, the remainder remains in force.');
  rule();

  // Signatures
  ensureSpace();
  doc.font('Helvetica-Bold').fontSize(9).text('Acceptance & Signature', L, y);
  const colW = (W - 20) / 2;
  const sY = y + 18;

  doc.font('Helvetica').fontSize(8.5).fillColor('#374151').text(`${company?.name || 'VoIP Shop'} (Provider)`, L, sY);
  doc.moveTo(L, sY + 20).lineTo(L + colW, sY + 20).strokeColor('#9CA3AF').stroke();
  doc.text('Name & Signature', L, sY + 24);
  doc.moveTo(L, sY + 48).lineTo(L + colW * 0.55, sY + 48).strokeColor('#E5E7EB').stroke();
  doc.text('Date', L + colW * 0.6, sY + 42);

  const CX = L + colW + 20;
  doc.text(`${customer?.name || 'Customer'} (Customer)`, CX, sY);
  doc.moveTo(CX, sY + 20).lineTo(CX + colW, sY + 20).strokeColor('#9CA3AF').stroke();
  doc.text('Name & Signature', CX, sY + 24);
  doc.moveTo(CX, sY + 48).lineTo(CX + colW * 0.55, sY + 48).strokeColor('#E5E7EB').stroke();
  doc.text('Date', CX + colW * 0.6, sY + 42);

  // Footer
  const footerY = doc.page.height - 32;
  doc.font('Helvetica').fontSize(7).fillColor('#6B7280')
     .text(`Agreement No: ${slaNumber} • Page ${doc.page.number}`, L, footerY, { width: W, align: 'right' });

  doc.end();
  return done;
}
