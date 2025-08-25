// api/send-invoice.js
import { Resend } from 'resend';
import PDFDocument from 'pdfkit';
import fetch from 'node-fetch';
import { put } from '@vercel/blob'; // only used if alsoLink === true

const resend = new Resend(process.env.RESEND_API_KEY);

// --- Company defaults (override via payload.company)
const COMPANY = {
  name: 'VoIP Shop',
  legal: 'Umojanet (Pty) Ltd t/a Darkwire', // optional
  reg: '2025/406791/07',                    // optional
  address: '23 Lombardy Road, Broadacres, Johannesburg',
  phone: '+27 68 351 0074',
  email: 'sales@voipshop.co.za',
  vatRate: 0.15,
  logoUrl: 'https://voipshop.co.za/Assets/Group%201642logo%20(1).png'
};

const money = (n) =>
  'R ' +
  Number(n || 0).toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

function withDefaults(input = {}) {
  const company = { ...COMPANY, ...(input.company || {}) };
  return {
    invoiceNumber: input.invoiceNumber || 'INV-' + Date.now(),
    orderNumber: input.orderNumber || input.invoiceNumber || 'VS-' + Math.floor(Math.random() * 1e6),
    dateISO: (input.dateISO || new Date().toISOString()).slice(0, 10),
    dueDays: Number(input.dueDays || 7),

    client: { ...(input.client || {}) },  // { name, company, email, phone, address }
    itemsOnceOff: Array.isArray(input.itemsOnceOff) ? input.itemsOnceOff : [],
    itemsMonthly: Array.isArray(input.itemsMonthly) ? input.itemsMonthly : [],
    subtotals: {
      onceOff: Number(input?.subtotals?.onceOff || 0), // ex VAT
      monthly: Number(input?.subtotals?.monthly || 0)  // ex VAT
    },
    notes: input.notes || 'Thank you for your order.',
    company,

    // Optional: details to prefill Porting LOA
    port: {
      provider: input?.port?.provider || '',
      accountNumber: input?.port?.accountNumber || '',
      type: input?.port?.type || '',
      numbers: Array.isArray(input?.port?.numbers) ? input.port.numbers : [],
      serviceAddress: input?.port?.serviceAddress || '',
      pbxLocation: input?.port?.pbxLocation || '',
      contactNumber: input?.port?.contactNumber || '',
      idNumber: input?.port?.idNumber || '',
      authorisedName: input?.port?.authorisedName || '',
      authorisedTitle: input?.port?.authorisedTitle || ''
    },

    alsoLink: Boolean(input.alsoLink) // if true, also upload invoice to Blob and return a link
  };
}

async function fetchBuffer(url) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

/* ===================== INVOICE (PDFKit) ===================== */
async function buildInvoicePdfBuffer(inv) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // Fetch logo (optional)
  const logoBuf = inv.company.logoUrl ? await fetchBuffer(inv.company.logoUrl) : null;

  const gray500 = '#6b7280';
  const border = '#e5e7eb';
  const band = '#f3f4f6';
  const thbg = '#f9fafb';

  // Header
  if (logoBuf) {
    try { doc.image(logoBuf, 40, 40, { width: 120 }); } catch {}
  }
  doc.font('Helvetica-Bold').fontSize(20).text('Invoice', 0, 40, { align: 'right' });
  doc.font('Helvetica').fontSize(10)
    .text(`Invoice #: ${inv.invoiceNumber}`, { align: 'right' })
    .text(`Order #: ${inv.orderNumber}`, { align: 'right' })
    .text(`Date: ${inv.dateISO}`, { align: 'right' })
    .text(`Due: ${inv.dueDays} days`, { align: 'right' });

  // Company & Client
  doc.moveDown(2);
  doc.font('Helvetica-Bold').fontSize(12).text(inv.company.name);
  doc.font('Helvetica').fontSize(10);
  if (inv.company.legal) doc.text(inv.company.legal);
  if (inv.company.reg)   doc.text(`Reg: ${inv.company.reg}`);
  doc.text(inv.company.address).text(`${inv.company.phone} • ${inv.company.email}`);

  doc.moveDown(1.2);
  doc.font('Helvetica-Bold').fontSize(11).text('Bill To');
  doc.font('Helvetica').fontSize(10)
     .text(inv.client.name || '')
     .text(inv.client.company || '')
     .text(inv.client.email || '')
     .text(inv.client.phone || '')
     .text(inv.client.address || '');

  // Totals
  const vat = Number(inv.company.vatRate ?? 0.15);
  const onceSub = Number(inv.subtotals.onceOff || 0);
  const monSub  = Number(inv.subtotals.monthly || 0);
  const onceVat = onceSub * vat;
  const monVat  = monSub * vat;
  const onceTotal = onceSub + onceVat;
  const monTotal  = monSub + monVat;
  const grandPayNow = onceTotal + monTotal;

  const yStartPills = doc.y + 14;
  doc.roundedRect(40, yStartPills, 230, 26, 6).strokeColor(border).stroke();
  doc.font('Helvetica').fontSize(9).fillColor(gray500).text('MONTHLY', 48, yStartPills + 6);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('black').text(`${money(monTotal)} `, 48, yStartPills + 14);
  doc.font('Helvetica').fontSize(9).fillColor(gray500).text('/month', 140, yStartPills + 16);

  doc.roundedRect(300, yStartPills, 230, 26, 6).strokeColor(border).stroke();
  doc.font('Helvetica').fontSize(9).fillColor(gray500).text('ONCE-OFF', 308, yStartPills + 6);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('black').text(`${money(onceTotal)} `, 308, yStartPills + 14);
  doc.font('Helvetica').fontSize(9).fillColor(gray500).text('setup', 410, yStartPills + 16);
  doc.fillColor('black');

  doc.moveDown(3);

  function table(title, items, subtotalEx, vatAmt, totalInc, monthly = false) {
    const pageW = doc.page.width;
    const left = doc.page.margins.left;
    const right = pageW - doc.page.margins.right;
    const width = right - left;
    const colW = [width * 0.58, width * 0.12, width * 0.12, width * 0.18];
    let y = doc.y;

    doc.font('Helvetica-Bold').fontSize(12).text(title, left, y);
    y = doc.y + 6;

    doc.save().rect(left, y, width, 18).fill(thbg).restore();
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Description', left + 6, y + 4, { width: colW[0] - 8 });
    doc.text('Qty', left + colW[0], y + 4, { width: colW[1], align: 'right' });
    doc.text('Unit', left + colW[0] + colW[1], y + 4, { width: colW[2], align: 'right' });
    doc.text('Amount', left + colW[0] + colW[1] + colW[2], y + 4, { width: colW[3], align: 'right' });
    doc.moveTo(left, y + 18).lineTo(right, y + 18).strokeColor('#e5e7eb').stroke();
    y += 22;

    doc.font('Helvetica').fontSize(10).fillColor('black');
    if (!items.length) {
      doc.text('No items.', left + 6, y);
      y = doc.y + 6;
    } else {
      for (const it of items) {
        const qty = Number(it.qty || 1);
        const unit = Number(it.unit ?? it.price ?? 0);
        const amount = unit * qty;

        doc.moveTo(left, y).lineTo(right, y).strokeColor('#e5e7eb').stroke();
        doc.text(String(it.name || ''), left + 6, y + 6, { width: colW[0] - 8 });
        doc.text(String(qty), left + colW[0], y + 6, { width: colW[1], align: 'right' });
        doc.text(money(unit), left + colW[0] + colW[1], y + 6, { width: colW[2], align: 'right' });
        doc.text(money(amount), left + colW[0] + colW[1] + colW[2], y + 6, { width: colW[3], align: 'right' });

        y += 24;
        if (y > doc.page.height - 180) {
          doc.addPage();
          y = doc.y;
        }
      }
    }

    doc.moveTo(left, y).lineTo(right, y).strokeColor('#e5e7eb').stroke();
    y += 8;

    const labelW = 120, valW = 90, valX = right - valW, labelX = valX - labelW - 6;
    const line = (label, val) => {
      doc.font('Helvetica').fontSize(10).text(label, labelX, y, { width: labelW, align: 'right' });
      doc.font('Helvetica-Bold').text(money(val), valX, y, { width: valW, align: 'right' });
      y += 16;
    };
    line('Subtotal', subtotalEx);
    line(`VAT (${Math.round((inv.company.vatRate ?? 0.15) * 100)}%)`, vatAmt);
    line(monthly ? 'Total / month' : 'Total (once-off)', totalInc);
    doc.y = y + 4;
  }

  table('Once-off Charges', inv.itemsOnceOff, onceSub, onceVat, onceTotal, false);
  doc.moveDown(0.8);
  table('Monthly Charges', inv.itemsMonthly, monSub, monVat, monTotal, true);
  doc.moveDown(1);

  // Grand total band
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;
  const yBand = doc.y + 4;
  doc.save().rect(left, yBand, width, 28).fill(band).restore();
  doc.rect(left, yBand, width, 28).strokeColor('#e5e7eb').stroke();
  doc.font('Helvetica-Bold').fontSize(12).text('Amount Due (incl VAT)', left + 10, yBand + 8);
  doc.text(money(grandPayNow), left, yBand + 8, { width, align: 'right' });

  doc.moveDown(3);
  doc.font('Helvetica').fontSize(9).fillColor(gray500)
     .text('Included: Professional install & device setup; Remote support; PBX configuration; Number porting assistance. Standard call-out fee: R450.');
  doc.moveDown(0.6).text(`Notes: ${inv.notes}`);
  doc.moveDown(0.6).text(`Payment terms: once-off on installation; monthly fees billed in advance.`);
  doc.moveDown(0.6).text(`Banking details available on request. Please use Order #${inv.orderNumber} as reference.`);
  doc.fillColor('black');

  doc.end();
  return done;
}
// services/buildSlaPdfBuffer.js
const PDFDocument = require('pdfkit');
const { fetchBuffer, drawBrandHeader } = require('../utils/pdf-branding');

/**
 * Build a dense, 1-page SLA PDF.
 * @param {{
 *   company: {
 *     name?: string, legal?: string, reg?: string, vat?: string,
 *     address?: string, phone?: string, email?: string, website?: string,
 *     logoUrl?: string
 *   },
 *   customer: {
 *     name?: string, contact?: string, email?: string, phone?: string,
 *     address?: string, reg?: string, vat?: string
 *   },
 *   slaNumber?: string,  // e.g. "SLA-2025-000123"
 *   effectiveDateISO?: string, // e.g. 2025-08-24
 *   noticeDays?: number, // default 30
 *   monthlyExVat?: number,       // auto-fill from checkout
 *   monthlyInclVat?: number,     // auto-fill from checkout
 *   vatRate?: number,            // default 0.15
 *   serviceDescription?: string, // short line shown in Fee Summary
 * }} params
 * @returns {Promise<Buffer>}
 */
async function buildSlaPdfBuffer(params) {
  const {
    company = {},
    customer = {},
    slaNumber = `SLA-${new Date().toISOString().slice(0,10).replace(/-/g,'')}`,
    effectiveDateISO = new Date().toISOString().slice(0,10),
    noticeDays = 30,
    monthlyExVat = 0,
    monthlyInclVat = 0,
    vatRate = 0.15,
    serviceDescription = 'Hosted PBX service with number porting, device provisioning, remote support'
  } = params;

  const doc = new PDFDocument({ size: 'A4', margin: 36 }); // tight margin to fit
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // Branding
  let logoBuf = null;
  if (company?.logoUrl) {
    try { logoBuf = await fetchBuffer(company.logoUrl); } catch {}
  }
  drawBrandHeader(doc, company, logoBuf);
  doc.on('pageAdded', () => drawBrandHeader(doc, company, logoBuf)); // repeat header automatically

  // Content helpers
  const left = 42;
  const right = doc.page.width - 42;
  let y = 72; // below header

  const h = (t) => { doc.font('Helvetica-Bold').fontSize(11).text(t, left, y, { width: right - left }); y = doc.y + 6; };
  const p = (txt, opts = {}) => {
    doc.font('Helvetica').fontSize(8.5).fillColor('#374151');
    doc.text(txt, left, y, { width: right - left, lineGap: 1.2, ...opts });
    y = doc.y + 6;
    doc.fillColor('black');
  };
  const bullet = (txt) => {
    doc.font('Helvetica').fontSize(8.5).fillColor('#374151');
    const bx = left + 10;
    doc.circle(left + 3.5, y + 4.5, 1.5).fill('#6b7280').fillColor('#374151');
    doc.text(txt, bx, y, { width: right - bx, lineGap: 1.1 });
    y = doc.y + 3.5;
    doc.fillColor('black');
  };
  const rule = () => { doc.moveTo(left, y).lineTo(right, y).strokeColor('#e5e7eb').lineWidth(1).stroke(); y += 8; };

  // Title & SLA meta
  doc.font('Helvetica-Bold').fontSize(16).text('Service Level Agreement (SLA)', left, y, { align: 'left' });
  doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text(`Agreement No: ${slaNumber}    •    Effective: ${effectiveDateISO}`, left, y + 20);
  doc.fillColor('black'); y += 36; rule();

  // Parties
  h('Parties');
  p(`${company?.name || 'VoIP Shop'} (“Provider”), ${company?.reg ? 'Reg: ' + company.reg + ', ' : ''}${company?.vat ? 'VAT: ' + company.vat + ', ' : ''}${company?.address || ''}.`);
  p(`${customer?.name || 'Customer'} (“Customer”), ${customer?.reg ? 'Reg: ' + customer.reg + ', ' : ''}${customer?.vat ? 'VAT: ' + customer.vat + ', ' : ''}${customer?.address || ''}.`);
  rule();

  // Scope of Service
  h('Scope of Service');
  bullet('Hosted PBX platform (SIP), DIDs and number porting, device provisioning, and remote support.');
  bullet('Inbound/outbound calling via Provider’s carrier partners (fair use and lawful usage apply).');
  bullet('Optional: onsite services, cabling, training, after-hours work (billable at then-current rates).');
  rule();

  // Service Levels (Response / Target Restore)
  h('Service Levels (Response & Target Restore)');
  p('Business hours: Mon–Fri 08:30–17:00 SAST. Support via WhatsApp +27 71 005 7691 and email sales@voipshop.co.za.');
  bullet('P1 outage (complete service loss): response within 1 hour; target restore within 8 hours.');
  bullet('P2 major impairment (degraded quality/multiple users): response within 4 hours; target restore within 1 business day.');
  bullet('P3 minor / Moves, Adds & Changes (MAC): response within 1 business day; target 2–3 business days.');
  bullet('Onsite: next business day (metro) or by arrangement; travel/after-hours rates may apply.');
  rule();

  // Customer Duties
  h('Customer Duties');
  bullet('Provide stable internet access, power, and LAN with suitable QoS; secure access for Provider when required.');
  bullet('Ensure lawful use of services; obtain consent where call recording/monitoring is enabled.');
  bullet('Designate authorised contacts for changes; review and approve porting forms and numbering plans.');
  rule();

  // Fees & Billing (auto-filled)
  const ex = Number.isFinite(monthlyExVat) ? monthlyExVat : 0;
  const inc = Number.isFinite(monthlyInclVat) ? monthlyInclVat : Math.round(ex * (1 + vatRate) * 100) / 100;
  h('Fees & Billing');
  p(`Monthly Service Fee (auto-filled from checkout for this Customer): R ${ex.toFixed(2)} (ex VAT), R ${inc.toFixed(2)} (incl VAT).`);
  bullet(`Service: ${serviceDescription}.`);
  bullet('Charges: once-off setup/hardware as quoted; monthly recurring fees billed in advance; call usage billed in arrears (if applicable).');
  bullet('Payment: debit order or EFT by due date on invoice. Non-payment may lead to suspension after notice.');
  bullet(`Term: month-to-month; either party may cancel with ${noticeDays} days’ written notice.`);
  rule();

  // Availability, Maintenance, Force Majeure
  h('Availability, Maintenance, Force Majeure');
  bullet('Provider will use commercially reasonable efforts to maintain service availability. Some downtime may occur due to carrier outages or scheduled maintenance.');
  bullet('Maintenance windows will be communicated in advance where practicable.');
  bullet('Provider is not responsible for failures caused by Customer’s ISP, LAN, power, or third-party carriers, or force majeure events.');
  rule();

  // Data Protection & Privacy
  h('Data Protection & Privacy');
  bullet('Provider processes Customer data solely to deliver services and as required by law.');
  bullet('Call recordings (if enabled) are retained per Customer policy; Customer is responsible for retention periods and disclosures.');
  bullet('Customer must not store unlawful content or contravene POPIA or other applicable laws.');
  rule();

  // Warranties, Liability, Indemnity
  h('Warranties, Liability, Indemnity');
  bullet('Services are provided “as is” except as expressly set out. No guarantee of uninterrupted service.');
  bullet('To the extent permitted by law, Provider is not liable for indirect or consequential loss (including loss of profit, revenue, or data).');
  bullet('Aggregate liability is capped at the lesser of three (3) months’ service fees or R100,000.');
  bullet('Customer indemnifies Provider against claims arising from unlawful use or Customer’s breach of this SLA.');
  rule();

  // Termination & Suspension
  h('Termination & Suspension');
  bullet(`Either party may terminate on ${noticeDays} days’ notice. Material breach not remedied within a reasonable period may lead to suspension or termination.`);
  bullet('On termination, numbers may be ported where legally/contractually allowed; unpaid fees remain due.');
  rule();

  // General
  h('General');
  bullet('This SLA forms part of the broader customer agreement (quotes, order forms, and policies). Conflicts are resolved by most recent signed quote/order.');
  bullet('South African law governs; venue Johannesburg. Variations require written agreement by both parties.');
  bullet('If any clause is found unenforceable, the remainder remains in force.');
  rule();

  // Signature block
  h('Acceptance & Signature');
  p('By signing below, the parties agree to this Service Level Agreement and confirm the Monthly Service Fee and scope described above.');
  const sigY = y + 6;
  const colW = (right - left - 20) / 2;

  // Provider sign line
  doc.font('Helvetica').fontSize(8.5).fillColor('#374151');
  doc.text(`${company?.name || 'VoIP Shop'} (Provider)`, left, sigY);
  doc.moveTo(left, sigY + 22).lineTo(left + colW, sigY + 22).strokeColor('#9ca3af').stroke();
  doc.text('Name & Signature', left, sigY + 26);
  doc.moveTo(left, sigY + 52).lineTo(left + colW * 0.55, sigY + 52).strokeColor('#e5e7eb').stroke();
  doc.text('Date', left + colW * 0.6, sigY + 46);

  // Customer sign line
  doc.text(`${customer?.name || 'Customer'} (Customer)`, left + colW + 20, sigY);
  doc.moveTo(left + colW + 20, sigY + 22).lineTo(left + colW + 20 + colW, sigY + 22).strokeColor('#9ca3af').stroke();
  doc.text('Name & Signature', left + colW + 20, sigY + 26);
  doc.moveTo(left + colW + 20, sigY + 52).lineTo(left + colW + 20 + colW * 0.55, sigY + 52).strokeColor('#e5e7eb').stroke();
  doc.text('Date', left + colW + 20 + colW * 0.6, sigY + 46);

  // Footer page number / tiny disclaimer
  const footerY = doc.page.height - 36;
  doc.font('Helvetica').fontSize(7).fillColor('#6b7280')
     .text(`Agreement No: ${slaNumber} • Page ${doc.page.number}`, left, footerY, { width: right - left, align: 'right' });

  // Done
  doc.end();
  return done;
}

module.exports = { buildSlaPdfBuffer };


/* ========== PORTING LETTER OF AUTHORITY (PDFKit) ========== */
/* Mirrors your uploaded “Non Geographic & Geographic Number Porting Request Form” and letter. */
async function buildPortingPdfBuffer({ company, client, port }) {
  const doc = new PDFDocument({ size: 'A4', margin: 42 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const gray600 = '#4b5563';
  const gray300 = '#d1d5db';
  const band = '#f3f4f6';

  // Safeguard objects
  company = company || {};
  client  = client  || {};
  port    = port    || {};

  /* -------- Page 1: Request Form -------- */
  let y = 42;
  const logoBuf = company.logoUrl ? await fetchBuffer(company.logoUrl) : null;
  if (logoBuf) { try { doc.image(logoBuf, 42, y, { width: 110 }); } catch {} }
  doc.font('Helvetica-Bold').fontSize(14).text('NON GEOGRAPHIC AND GEOGRAPHIC NUMBER PORTING REQUEST FORM', 0, y, { align: 'right' });
  y += 26;

  // Instruction line (from your form)
  doc.font('Helvetica').fontSize(10).fillColor(gray600)
    .text(`This request form authorises ${company.name || 'VoIP Shop'} to request that the service and current telephone number(s) specified below be transferred to ${company.name || 'VoIP Shop'}.`,
      42, y, { width: 511, lineGap: 2 });
  doc.fillColor('black'); y = doc.y + 12;

  // Divider
  doc.moveTo(42, y).lineTo(553, y).strokeColor(gray300).stroke(); y += 12;

  // Helpers
  const kv = (label, value = '') => {
    const wL = 260, wV = 511 - wL - 8, vX = 42 + wL + 8;
    doc.font('Helvetica-Bold').fontSize(10).text(label, 42, y, { width: wL });
    doc.font('Helvetica').fontSize(10).fillColor(gray600).text(String(value || '_____________________________'), vX, y, { width: wV });
    doc.fillColor('black'); y = doc.y + 10;
  };
  const note = (t) => { doc.font('Helvetica').fontSize(9).fillColor(gray600).text(t, 42, y, { width: 511 }); doc.fillColor('black'); y = doc.y + 8; };

  // Fields (mapped to your form)
  kv('Subscriber Name', client.company || client.name || '');
  kv('Name & designation of person authorised to make this request if subscriber is a company', port.authorisedName ? `${port.authorisedName}${port.authorisedTitle ? ' — ' + port.authorisedTitle : ''}` : '');
  kv('Contact Number', port.contactNumber || client.phone || '');
  kv('South African Identity / Passport Number', port.idNumber || '');
  kv('Present Service Provider', port.provider || '');
  kv('Present Service Provider — Account Number', port.accountNumber || '');
  note('Please attach a copy of your latest invoice to confirm numbers and account status');

  kv('Service Address', port.serviceAddress || client.address || '');
  kv('Geographical Numbers to be ported', (Array.isArray(port.numbers) && port.numbers.length) ? port.numbers.join(', ') : '');
  kv('PBX Location', port.pbxLocation || '');

  // Advisory (from your form)
  note('Please ensure that none of the above mentioned numbers are linked to any video conferencing services nor are they the target number for any 0800 or 086 service.');

  // Declaration block (adapted with your company name)
  y += 6;
  doc.save().rect(42, y, 511, 18).fill(band).restore();
  doc.font('Helvetica-Bold').fontSize(11).text('Declaration', 48, y + 4);
  y += 26;

  const decl = [
    `${company.name || 'VoIP Shop'} is hereby authorised to request that my present service provider port the above numbers to ${company.name || 'VoIP Shop'}. I am duly authorised to make this request and to the best of my knowledge the above information is correct.`,
    'I acknowledge that the subscriber shall remain liable in terms of any contract with the present service provider for so long as it remains in force.',
    'Credits and discounts afforded to the subscriber by the present service provider are not transferrable.',
    'I have been advised of the porting costs and the subscriber agrees to be liable for such costs.'
  ];
  doc.font('Helvetica').fontSize(10).fillColor(gray600);
  for (let i = 0; i < decl.length; i++) {
    doc.text(`${i + 1}. ${decl[i]}`, 42, y, { width: 511, lineGap: 2 });
    y = doc.y + 6;
  }
  doc.fillColor('black');

  // Sign & Date lines
  y += 8;
  const drawLine = (label, w = 200) => {
    doc.font('Helvetica').fontSize(10).text(label, 42, y + 2);
    doc.moveTo(42 + 70, y + 8).lineTo(42 + 70 + w, y + 8).strokeColor(gray300).stroke();
  };
  drawLine('Sign:', 220);
  doc.text('', 0, y); // advance baseline
  y += 20;
  drawLine('Date:', 130);

  /* -------- Page 2: “To whom it may concern” Letter -------- */
  doc.addPage();
  y = 42;
  if (logoBuf) { try { doc.image(logoBuf, 42, y, { width: 110 }); } catch {} }
  doc.font('Helvetica-Bold').fontSize(14).text('Porting — To whom it may concern', 0, y, { align: 'right' });
  y += 28;
  doc.moveTo(42, y).lineTo(553, y).strokeColor(gray300).stroke(); y += 14;

  const p = (txt) => { doc.font('Helvetica').fontSize(10).fillColor(gray600).text(txt, 42, y, { width: 511, lineGap: 2 }); y = doc.y + 10; doc.fillColor('black'); };

  p(`I, _______________________________________ hereby give permission to ${company.name || '(new service provider)'} to port the following numbers from the current service provider.`); // blank to handwrite if needed
  p(`Current service provider Account No: ${port.accountNumber || '_______________________________'}`);
  p(`The number/number range(s) we want ported is/are: ${(Array.isArray(port.numbers) && port.numbers.length) ? port.numbers.join(', ') : '_______________________________'}.`);
  p('We acknowledge that any numbers in the range that are not ported will be lost and cannot be recovered.');
  p('We acknowledge that ADSL functionality linked to the number being ported may be lost after porting.');
  p('We acknowledge that if we have any other subscriptions (e.g. switchboard or other services) we no longer need, we have to directly contact our current Service Provider AFTER porting has been completed, and instruct them to cancel the subscriptions/services.');
  p('Kind regards,');

  // Signature block
  y += 6;
  drawLine('Sign:', 220);
  y += 22;
  drawLine('Full Name:', 260);
  y += 22;
  drawLine('Designation:', 180);

  doc.end();
  return done;
}

/* ============================ HANDLER ============================ */
export default async function handler(req, res) {
  // --- Robust CORS (works from http://127.0.0.1:5500, etc.) ---
  const origin = req.headers.origin || '*';
  const acrh   = req.headers['access-control-request-headers'] || '';

  res.setHeader('Vary', 'Origin, Access-Control-Request-Headers');
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', acrh || 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400'); // cache preflight

  if (req.method === 'OPTIONS') {
    return res.status(204).end(); // preflight OK, no body
  }

  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const body = req.body || {};
    const inv = withDefaults(body);
    if (!inv?.client?.email) return res.status(400).send('Missing client email.');

    // 1) Build PDFs
    const [invoicePdf, slaPdf, portingPdf] = await Promise.all([
      buildInvoicePdfBuffer(inv),
      buildSlaPdfBuffer({ company: inv.company }),
      buildPortingPdfBuffer({ company: inv.company, client: inv.client, port: inv.port })
    ]);

    // 2) Optionally upload INVOICE to Blob (public link for post-checkout page)
    let pdfUrl = '';
    if (inv.alsoLink && process.env.BLOB_READ_WRITE_TOKEN) {
      const key = `invoices/${new Date().toISOString().slice(0, 10)}/invoice-${inv.invoiceNumber.replace(/[^\w\-]+/g, '-')}.pdf`;
      const putRes = await put(key, invoicePdf, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        contentType: 'application/pdf',
        addRandomSuffix: false
      });
      pdfUrl = putRes.url;
    }

    // 3) Email (exactly 3 attachments: Invoice, SLA, Porting)
    const vat = Number(inv.company.vatRate ?? 0.15);
    const monthlyInclVat = (inv.subtotals.monthly || 0) * (1 + vat);

    const attachments = [
      { filename: `Invoice-${inv.invoiceNumber}.pdf`,           content: invoicePdf.toString('base64'), contentType: 'application/pdf' },
      { filename: `Service-Level-Agreement.pdf`,                content: slaPdf.toString('base64'),     contentType: 'application/pdf' },
      { filename: `Porting-Letter-of-Authority-${inv.orderNumber}.pdf`, content: portingPdf.toString('base64'), contentType: 'application/pdf' }
    ];

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial;color:#111;max-width:560px;margin:0 auto;padding:24px;">
        <div style="text-align:center;margin-bottom:16px;">
          ${inv.company.logoUrl ? `<img src="${inv.company.logoUrl}" alt="${inv.company.name}" style="height:36px;">` : ''}
        </div>
        <p>Hi ${inv.client.name || 'there'},</p>
        <p>Thanks for your order <strong>#${inv.orderNumber}</strong>. Your <strong>invoice (${inv.invoiceNumber})</strong> is attached.</p>
        <p>Your estimated <strong>monthly bill is ${money(monthlyInclVat)}</strong>.</p>
        <p>We also attached the <strong>SLA</strong> and the <strong>Porting Letter of Authority</strong> for signing. You can upload the signed copies on our site or reply to this email with them.</p>
        ${pdfUrl ? `<p style="text-align:center;margin:24px 0;">
          <a href="${pdfUrl}" style="background:#111;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;display:inline-block;">Download Invoice (PDF)</a>
        </p>` : ''}
        <p>— ${inv.company.name} Team</p>
      </div>`;

    const { error, data } = await resend.emails.send({
      from: 'sales@voipshop.co.za',
      to: inv.client.email,
      reply_to: 'sales@voipshop.co.za',
      subject: `Invoice ${inv.invoiceNumber} • Order ${inv.orderNumber} • VoIP Shop`,
      html,
      attachments
    });
    if (error) throw error;

    return res.status(200).json({
      ok: true,
      id: data?.id,
      invoiceNumber: inv.invoiceNumber,
      orderNumber: inv.orderNumber,
      pdfUrl,
      attached: { invoice: true, sla: true, porting: true }
    });
  } catch (err) {
    console.error('send-invoice error', err);
    return res.status(500).send(String(err?.message || err) || 'Failed to create/send invoice.');
  }
}
