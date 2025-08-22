// api/send-invoice.js
import { Resend } from 'resend';
import PDFDocument from 'pdfkit';
import fetch from 'node-fetch';
import { put } from '@vercel/blob'; // only used if alsoLink === true

const resend = new Resend(process.env.RESEND_API_KEY);

// --- Config: set your doc URLs here or pass in req.body.attachments.{portingDocUrl, slaUrl}
const PORTING_DOC_URL = process.env.PORTING_DOC_URL || 'https://your-domain.com/docs/porting-letter-of-authority.pdf';
const SLA_DOC_URL     = process.env.SLA_DOC_URL     || 'https://your-domain.com/docs/sla.pdf';

// --- Company defaults (override via payload.company)
const COMPANY = {
  name: 'VoIP Shop',
  address: '23 Lombardy Road, Broadacres, Johannesburg',
  phone: '+27 68 351 0074',
  email: 'sales@voipshop.co.za',
  vatRate: 0.15,
  logoUrl: 'https://voipshop.co.za/Assets/Group%201642logo%20(1).png'
};

const money = (n) => 'R ' + Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function withDefaults(input = {}) {
  const company = { ...COMPANY, ...(input.company || {}) };
  return {
    invoiceNumber: input.invoiceNumber || 'INV-' + Date.now(),
    orderNumber: input.orderNumber || input.invoiceNumber || 'VS-' + Math.floor(Math.random() * 1e6),
    dateISO: (input.dateISO || new Date().toISOString()).slice(0, 10),
    dueDays: Number(input.dueDays || 7),
    client: { ...(input.client || {}) },
    itemsOnceOff: Array.isArray(input.itemsOnceOff) ? input.itemsOnceOff : [],
    itemsMonthly: Array.isArray(input.itemsMonthly) ? input.itemsMonthly : [],
    subtotals: {
      onceOff: Number(input?.subtotals?.onceOff || 0),   // ex VAT
      monthly: Number(input?.subtotals?.monthly || 0)    // ex VAT
    },
    notes: input.notes || 'Thank you for your order.',
    company,
    attachments: {
      portingDocUrl: input?.attachments?.portingDocUrl || PORTING_DOC_URL,
      slaUrl: input?.attachments?.slaUrl || SLA_DOC_URL
    },
    alsoLink: Boolean(input.alsoLink) // if true, also upload to Blob and return a link
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

// --- Build Invoice PDF (same style as quote, but says "Invoice")
async function buildInvoicePdfBuffer(inv) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // Fetch logo (optional)
  let logoBuf = null;
  try {
    if (inv.company.logoUrl) {
      const r = await fetch(inv.company.logoUrl, { cache: 'no-store' });
      if (r.ok) logoBuf = Buffer.from(await r.arrayBuffer());
    }
  } catch {}

  const gray500 = '#6b7280';
  const border = '#e5e7eb';
  const band = '#f3f4f6';
  const thbg = '#f9fafb';

  // Header
  if (logoBuf) { try { doc.image(logoBuf, 40, 40, { width: 120 }); } catch {} }
  doc.font('Helvetica-Bold').fontSize(20).text('Invoice', 0, 40, { align: 'right' });
  doc.font('Helvetica').fontSize(10)
     .text(`Invoice #: ${inv.invoiceNumber}`, { align: 'right' })
     .text(`Order #: ${inv.orderNumber}`, { align: 'right' })
     .text(`Date: ${inv.dateISO}`, { align: 'right' })
     .text(`Due: ${inv.dueDays} days`, { align: 'right' });

  // Company & Client
  doc.moveDown(2);
  doc.font('Helvetica-Bold').fontSize(12).text(inv.company.name);
  doc.font('Helvetica').fontSize(10)
     .text(inv.company.address)
     .text(`${inv.company.phone} • ${inv.company.email}`);

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

  function table(title, items, subtotalEx, vatAmt, totalInc, monthly=false) {
    const pageW = doc.page.width;
    const left = doc.page.margins.left;
    const right = pageW - doc.page.margins.right;
    const width = right - left;
    const colW = [ width * 0.58, width * 0.12, width * 0.12, width * 0.18 ];
    let y = doc.y;

    doc.font('Helvetica-Bold').fontSize(12).text(title, left, y);
    y = doc.y + 6;

    doc.save().rect(left, y, width, 18).fill(thbg).restore();
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Description', left + 6, y + 4, { width: colW[0] - 8 });
    doc.text('Qty',    left + colW[0],                 y + 4, { width: colW[1], align: 'right' });
    doc.text('Unit',   left + colW[0] + colW[1],       y + 4, { width: colW[2], align: 'right' });
    doc.text('Amount', left + colW[0] + colW[1] + colW[2], y + 4, { width: colW[3], align: 'right' });
    doc.moveTo(left, y + 18).lineTo(right, y + 18).strokeColor(border).stroke();
    y += 22;

    doc.font('Helvetica').fontSize(10).fillColor('black');
    if (!items.length) {
      doc.text('No items.', left + 6, y); y = doc.y + 6;
    } else {
      for (const it of items) {
        const qty = Number(it.qty || 1);
        const unit = Number(it.unit ?? it.price ?? 0);
        const amount = unit * qty;

        doc.moveTo(left, y).lineTo(right, y).strokeColor(border).stroke();
        doc.text(String(it.name || ''), left + 6, y + 6, { width: colW[0] - 8 });
        doc.text(String(qty), left + colW[0], y + 6, { width: colW[1], align: 'right' });
        doc.text(money(unit), left + colW[0] + colW[1], y + 6, { width: colW[2], align: 'right' });
        doc.text(money(amount), left + colW[0] + colW[1] + colW[2], y + 6, { width: colW[3], align: 'right' });

        y += 24;
        if (y > doc.page.height - 180) { doc.addPage(); y = doc.y; }
      }
    }

    doc.moveTo(left, y).lineTo(right, y).strokeColor(border).stroke(); y += 8;

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
  doc.rect(left, yBand, width, 28).strokeColor(border).stroke();
  doc.font('Helvetica-Bold').fontSize(12).text('Amount Due (incl VAT)', left + 10, yBand + 8);
  doc.text(money(grandPayNow), left, yBand + 8, { width, align: 'right' });

  doc.moveDown(3);
  doc.font('Helvetica').fontSize(9).fillColor(gray500)
     .text('Included: Professional install & device setup; Remote support; PBX configuration; Number porting assistance. Standard call-out fee: R450.');
  doc.moveDown(0.6).text(`Notes: ${inv.notes}`);
  doc.moveDown(0.6).text(`Payment terms: once-off on installation; monthly fees billed in advance.`);
  doc.moveDown(0.6).text(`Banking details available on request. Please use Order #${inv.orderNumber} as reference.`);

  doc.end();
  return done;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const body = req.body || {};
    const inv = withDefaults(body);
    if (!inv?.client?.email) return res.status(400).send('Missing client email.');

    // 1) Build invoice PDF
    const invoicePdf = await buildInvoicePdfBuffer(inv);

    // 2) Fetch extra attachments (best-effort)
    const portingBuf = await fetchBuffer(inv.attachments.portingDocUrl);
    const slaBuf     = await fetchBuffer(inv.attachments.slaUrl);

    // 3) Optionally also upload invoice to Blob, so you can link "Download Invoice" on the thank-you page
    let pdfUrl = '';
    if (inv.alsoLink && process.env.BLOB_READ_WRITE_TOKEN) {
      const key = `invoices/${new Date().toISOString().slice(0,10)}/invoice-${inv.invoiceNumber.replace(/[^\w\-]+/g,'-')}.pdf`;
      const putRes = await put(key, invoicePdf, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        contentType: 'application/pdf',
        addRandomSuffix: false
      });
      pdfUrl = putRes.url;
    }

    // 4) Send email with attachments
    const vat = Number(inv.company.vatRate ?? 0.15);
    const monthlyInclVat = (inv.subtotals.monthly || 0) * (1 + vat);

    const attachments = [
      {
        filename: `Invoice-${inv.invoiceNumber}.pdf`,
        content: invoicePdf.toString('base64'),
        contentType: 'application/pdf'
      }
    ];
    if (portingBuf) attachments.push({ filename: 'Porting-Letter-of-Authority.pdf', content: portingBuf.toString('base64'), contentType: 'application/pdf' });
    if (slaBuf)     attachments.push({ filename: 'Service-Level-Agreement.pdf', content: slaBuf.toString('base64'), contentType: 'application/pdf' });

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial;color:#111;max-width:560px;margin:0 auto;padding:24px;">
        <div style="text-align:center;margin-bottom:16px;">
          ${inv.company.logoUrl ? `<img src="${inv.company.logoUrl}" alt="${inv.company.name}" style="height:36px;">` : ''}
        </div>
        <p>Hi ${inv.client.name || 'there'},</p>
        <p>Thanks for your order <strong>#${inv.orderNumber}</strong>. Your <strong>invoice (${inv.invoiceNumber})</strong> is attached.</p>
        <p>Your estimated <strong>monthly bill is ${money(monthlyInclVat)}</strong>.</p>
        <p>We also attached the <strong>Porting Document</strong> and <strong>SLA</strong> for signing. You can upload the signed copies on our site or reply to this email with them.</p>
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

    return res.status(200).json({ ok: true, id: data?.id, invoiceNumber: inv.invoiceNumber, orderNumber: inv.orderNumber, pdfUrl });
  } catch (err) {
    console.error('send-invoice error', err);
    return res.status(500).send(String(err?.message || err) || 'Failed to create/send invoice.');
  }
}
