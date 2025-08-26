// api/complete-order.js
import { Resend } from 'resend';
import { buildInvoicePdfBuffer } from '../services/buildInvoicePdfBuffer.js';
import { buildSlaPdfBuffer } from '../services/buildSlaPdfBuffer.js';
import { buildPortingPdfBuffer } from '../services/buildPortingPdfBuffer.js';

const resend = new Resend(process.env.RESEND_API_KEY);

// Money helper
const money = (n) =>
  'R ' + Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Company defaults (can be overridden by req.body.company)
const COMPANY_DEFAULTS = {
  name: 'VoIP Shop',
  address: '23 Lombardy Road, Broadacres, Johannesburg',
  phone: '+27 68 351 0074',
  email: 'sales@voipshop.co.za',
  website: 'https://voipshop.co.za',
  vatRate: 0.15,
  logoUrl: 'https://voipshop.co.za/Assets/Group%201642logo%20(1).png',
  colors: {
    brand: '#0B63E6',
    ink:   '#0f172a',
    gray6: '#475569',
    gray4: '#94a3b8',
    line:  '#e5e7eb',
    thbg:  '#f8fafc',
    pill:  '#f1f5f9'
  }
};

// Normalise the checkout payload you send from your UI
function normalizeCheckout(input = {}) {
  const company = { ...COMPANY_DEFAULTS, ...(input.company || {}) };

  const client = {
    name:    input.customer?.name || '',
    company: input.customer?.company || '',
    email:   input.customer?.email || '',
    phone:   input.customer?.phone || '',
    address: input.customer?.address || ''
  };

  // Line items for invoice / quote-like tables
  const itemsOnceOff = Array.isArray(input.onceOff?.items) ? input.onceOff.items : [];
  const itemsMonthly = Array.isArray(input.monthly?.items) ? input.monthly.items : [];

  const subtotals = {
    onceOff: Number(input.onceOff?.totals?.exVat || 0),
    monthly: Number(input.monthly?.totals?.exVat || 0)
  };

  // Minimal services list for SLA (from “Monthly” section)
  const services = [
    { name: 'Cloud PBX', qty: input.monthly?.cloudPbxQty ?? 1 },
    { name: 'Extensions', qty: input.monthly?.extensions ?? 3 },
    { name: 'Geographic Number (DID)', qty: input.monthly?.didQty ?? 1 },
    { name: 'Voice Minutes (bundle)', qty: input.monthly?.minutes ?? 250, unit: 'min' },
  ];

  const debitOrder = {
    accountName:  input.debit?.accountName,
    bank:         input.debit?.bank,
    branchCode:   input.debit?.branchCode,
    accountNumber:input.debit?.accountNumber,
    accountType:  input.debit?.accountType,
    dayOfMonth:   input.debit?.dayOfMonth,
    mandateDateISO: new Date().toISOString().slice(0,10),
  };

  const port = {
    provider:        input.port?.provider || '',
    accountNumber:   input.port?.accountNumber || '',
    numbers:         Array.isArray(input.port?.numbers) ? input.port.numbers : [],
    serviceAddress:  input.port?.serviceAddress || '',
    pbxLocation:     input.port?.pbxLocation || '',
    contactNumber:   input.port?.contactNumber || client.phone || '',
    idNumber:        input.port?.idNumber || '',
    authorisedName:  input.port?.authorisedName || '',
    authorisedTitle: input.port?.authorisedTitle || ''
  };

  return {
    company,
    client,
    itemsOnceOff,
    itemsMonthly,
    subtotals,
    services,
    debitOrder,
    // handy IDs/dates
    orderNumber: input.orderNumber || 'VS-' + Math.floor(Math.random() * 1e6),
    invoiceNumber: input.invoiceNumber || 'INV-' + Date.now(),
    slaNumber: input.slaNumber || 'SLA-' + new Date().toISOString().slice(0,10).replace(/-/g,''),
    dateISO: (input.dateISO || new Date().toISOString()).slice(0,10),
    effectiveDate: input.effectiveDate || (new Date().toISOString()).slice(0,10),
    port
  };
}

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || '*';
  const acrh   = req.headers['access-control-request-headers'] || '';
  res.setHeader('Vary', 'Origin, Access-Control-Request-Headers');
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', acrh || 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const checkout = normalizeCheckout(req.body || {});
    if (!checkout.client.email) return res.status(400).send('Missing client email.');

    // --- Build the three PDFs in parallel
    const [invoicePdf, slaPdf, portingPdf] = await Promise.all([
      buildInvoicePdfBuffer({
        invoiceNumber: checkout.invoiceNumber,
        orderNumber: checkout.orderNumber,
        dateISO: checkout.dateISO,
        dueDays: Number(req.body?.dueDays || 7),
        client: checkout.client,
        itemsOnceOff: checkout.itemsOnceOff,
        itemsMonthly: checkout.itemsMonthly,
        subtotals: checkout.subtotals,
        notes: req.body?.notes || 'Thank you for your order.',
        stamp: req.body?.stamp || '',   // e.g. 'PAID'
        compact: !!req.body?.compact,
        company: checkout.company
      }),

      buildSlaPdfBuffer({
        company: checkout.company,
        customer: {
          name: checkout.client.company || checkout.client.name,
          contact: checkout.client.name,
          email: checkout.client.email,
          phone: checkout.client.phone,
          address: checkout.client.address
        },
        slaNumber: checkout.slaNumber,
        effectiveDateISO: checkout.effectiveDate,
        noticeDays: 30,
        monthlyExVat: checkout.subtotals.monthly,
        monthlyInclVat: checkout.subtotals.monthly * (1 + Number(checkout.company.vatRate ?? 0.15)),
        vatRate: Number(checkout.company.vatRate ?? 0.15),
        services: checkout.services,
        debitOrder: checkout.debitOrder,
        serviceDescription: 'Hosted PBX (incl. porting, device provisioning, remote support)'
      }),

      buildPortingPdfBuffer({
        company: { name: checkout.company.name, logoUrl: checkout.company.logoUrl },
        client:  checkout.client,
        port:    checkout.port
      })
    ]);

    // --- Compose one email with 3 attachments
    const monthlyInclVat = Number(checkout.subtotals.monthly || 0) * (1 + Number(checkout.company.vatRate ?? 0.15));

    const { error, data } = await resend.emails.send({
      from: 'sales@voipshop.co.za',
      to: checkout.client.email,
      reply_to: 'sales@voipshop.co.za',
      subject: `VoIP Shop • Order ${checkout.orderNumber} • Invoice ${checkout.invoiceNumber}`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial;color:#111;max-width:560px;margin:0 auto;padding:24px;">
          <div style="text-align:center;margin-bottom:16px;">
            ${checkout.company.logoUrl ? `<img src="${checkout.company.logoUrl}" alt="${checkout.company.name}" style="height:36px;">` : ''}
          </div>
          <p>Hi ${checkout.client.name || 'there'},</p>
          <p>Thanks for completing your order <strong>#${checkout.orderNumber}</strong>.</p>
          <p>Your estimated <strong>monthly bill is ${money(monthlyInclVat)}</strong>.</p>
          <p>Attached you’ll find:</p>
          <ul>
            <li><strong>Invoice ${checkout.invoiceNumber}</strong></li>
            <li><strong>Service Level Agreement (SLA)</strong></li>
            <li><strong>Porting Letter of Authority</strong></li>
          </ul>
          <p>Please sign and return the SLA and Porting LOA so we can proceed.</p>
          <p>— ${checkout.company.name} Team</p>
        </div>`,
      attachments: [
        { filename: `Invoice-${checkout.invoiceNumber}.pdf`, content: invoicePdf.toString('base64'), contentType: 'application/pdf' },
        { filename: `Service-Level-Agreement-${checkout.slaNumber}.pdf`, content: slaPdf.toString('base64'), contentType: 'application/pdf' },
        { filename: `Porting-Letter-of-Authority-${checkout.orderNumber}.pdf`, content: portingPdf.toString('base64'), contentType: 'application/pdf' }
      ]
    });
    if (error) throw error;

    return res.status(200).json({ ok: true, id: data?.id, attached: { invoice: true, sla: true, porting: true } });
  } catch (err) {
    console.error('complete-order error', err);
    return res.status(500).send(String(err?.message || err) || 'Failed to complete order email.');
  }
}
