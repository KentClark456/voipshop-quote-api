// /api/complete-order.js
import { Resend } from 'resend';
import { buildInvoicePdfBuffer } from '../services/buildInvoicePdfBuffer.js';
import { buildSlaPdfBuffer } from '../services/buildSlaPdfBuffer.js';
import { buildPortingPdfBuffer } from '../services/buildPortingPdfBuffer.js';

// Ensure we run on the Node serverless runtime (not Edge)
export const config = { runtime: 'nodejs' };

const resend = new Resend(process.env.RESEND_API_KEY);

// --- CORS allowlist (add/remove domains as needed) ---
const ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'https://voipshop.co.za',
  'https://www.voipshop.co.za',
  'https://voipshop-site.vercel.app'
]);

function setCors(res, origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://voipshop.co.za';
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Vary', 'Origin, Access-Control-Request-Headers');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24h preflight cache
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  setCors(res, origin);

  // Preflight
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    res.setHeader('Content-Type', 'application/json');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = req.body || {};
    const {
      customer = {},       // { name, company, email, phone, address }
      onceOff = { items: [], totals: { exVat: 0 } },
      monthly = { items: [], totals: { exVat: 0 }, cloudPbxQty: 1, extensions: 3, didQty: 1, minutes: 250 },
      debit = {},          // { accountName, bank, branchCode, accountNumber, accountType, dayOfMonth }
      port = {},           // { provider, accountNumber, numbers[], ... }
      orderNumber,
      invoiceNumber
    } = body;

    if (!customer?.email) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ error: 'Missing customer email.' });
    }

    // --- Company defaults
    const COMPANY = {
      name: 'VoIP Shop',
      reg: '2025/406791/07',
      vat: '***',
      address: '23 Lombardy Road, Broadacres, Johannesburg',
      phone: '+27 68 351 0074',
      email: 'sales@voipshop.co.za',
      website: 'https://voipshop.co.za',
      vatRate: 0.15,
      logoUrl: 'https://voipshop.co.za/Assets/Group%201642logo%20(1).png'
    };

    // ---- Build PDFs in parallel
    const invoicePayload = {
      invoiceNumber: invoiceNumber || 'INV-' + Date.now(),
      orderNumber: orderNumber || 'VS-' + Math.floor(Math.random() * 1e6),
      dateISO: new Date().toISOString().slice(0, 10),
      client: {
        name: customer.name || customer.company || '',
        company: customer.company || '',
        email: customer.email,
        phone: customer.phone || '',
        address: customer.address || ''
      },
      itemsOnceOff: (onceOff.items || []).map(i => ({
        name: i.name, qty: Number(i.qty || 1), unit: Number(i.unit || 0)
      })),
      itemsMonthly: (monthly.items || []).map(i => ({
        name: i.name, qty: Number(i.qty || 1), unit: Number(i.unit || 0)
      })),
      subtotals: {
        onceOff: Number(onceOff?.totals?.exVat || 0),
        monthly: Number(monthly?.totals?.exVat || 0)
      },
      notes: 'Thank you for your order.',
      company: COMPANY,
      port // optional
    };

    const slaPayload = {
      company: COMPANY,
      customer: {
        name: customer.company || customer.name || 'Customer',
        contact: customer.name || '',
        email: customer.email,
        phone: customer.phone || '',
        address: customer.address || ''
      },
      slaNumber: 'SLA-' + new Date().toISOString().slice(0,10).replace(/-/g,''),
      effectiveDateISO: new Date().toISOString().slice(0,10),
      noticeDays: 30,
      monthlyExVat: Number(monthly?.totals?.exVat || 0),
      monthlyInclVat: Number(monthly?.totals?.exVat || 0) * (1 + Number(COMPANY.vatRate || 0.15)),
      vatRate: Number(COMPANY.vatRate || 0.15),
      services: [
        { name: 'Cloud PBX', qty: Number(monthly.cloudPbxQty || 1) },
        { name: 'Extensions', qty: Number(monthly.extensions || 3) },
        { name: 'Geographic Number (DID)', qty: Number(monthly.didQty || 1) },
        { name: 'Voice Minutes (bundle)', qty: Number(monthly.minutes || 250), unit: 'min' }
      ],
      debitOrder: {
        accountName: debit.accountName,
        bank: debit.bank,
        branchCode: debit.branchCode,
        accountNumber: debit.accountNumber,
        accountType: debit.accountType,
        dayOfMonth: debit.dayOfMonth,
        mandateDateISO: new Date().toISOString().slice(0,10)
      },
      serviceDescription: 'Hosted PBX (incl. porting, device provisioning, remote support)'
    };

    const portingPayload = { company: COMPANY, client: invoicePayload.client, port };

    let invoicePdf, slaPdf, portingPdf;
    try {
      [invoicePdf, slaPdf, portingPdf] = await Promise.all([
        buildInvoicePdfBuffer(invoicePayload),  // -> Buffer
        buildSlaPdfBuffer(slaPayload),          // -> Buffer
        buildPortingPdfBuffer(portingPayload)   // -> Buffer
      ]);
    } catch (e) {
      console.error('[complete-order] PDF builder error:', e);
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ error: 'Failed to build one of the PDFs: ' + (e.message || String(e)) });
    }

    // ---- Send one email with 3 attachments
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial;color:#111;max-width:560px;margin:0 auto;padding:24px;">
        <div style="text-align:center;margin-bottom:16px;">
          ${COMPANY.logoUrl ? `<img src="${COMPANY.logoUrl}" alt="${COMPANY.name}" style="height:36px;">` : ''}
        </div>
        <p>Hi ${invoicePayload.client.name || 'there'},</p>
        <p>Thank you for your order ${invoicePayload.orderNumber}. We’ve attached your <strong>Invoice</strong>, <strong>Service Level Agreement</strong> and <strong>Porting Letter of Authority</strong>.</p>
        <p>— ${COMPANY.name} Team</p>
      </div>`;

    const { error, data } = await resend.emails.send({
      from: 'sales@voipshop.co.za', // must be a verified sender/domain in Resend
      to: invoicePayload.client.email,
      reply_to: 'sales@voipshop.co.za',
      subject: `Order ${invoicePayload.orderNumber} • Invoice, SLA & Porting • VoIP Shop`,
      html,
      attachments: [
        { filename: `Invoice-${invoicePayload.invoiceNumber}.pdf`, content: invoicePdf, contentType: 'application/pdf' },
        { filename: `Service-Level-Agreement.pdf`,                content: slaPdf,     contentType: 'application/pdf' },
        { filename: `Porting-Letter-of-Authority.pdf`,            content: portingPdf, contentType: 'application/pdf' }
      ]
    });

    if (error) {
      console.error('[complete-order] Resend error:', error);
      res.setHeader('Content-Type', 'application/json');
      return res.status(502).json({ error: 'Email send failed: ' + (error?.message || 'unknown') });
    }

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ ok: true, id: data?.id });
  } catch (err) {
    console.error('[complete-order] handler error:', err);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ error: String(err?.message || err) || 'Failed to complete order.' });
  }
}
