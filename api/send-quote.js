// api/send-quote.js
import { Resend } from 'resend';
import { put } from '@vercel/blob';            // Only used if delivery === 'link' or USE_BLOB_LINK=1
import PDFDocument from 'pdfkit';
import fetch from 'node-fetch';                // Node 18+ has global fetch, but this keeps it explicit

const resend = new Resend(process.env.RESEND_API_KEY);

// ---- Company defaults (override via payload.company) ----
const COMPANY_DEFAULTS = {
  name: 'VoIP Shop',
  address: '23 Lombardy Road, Broadacres, Johannesburg',
  phone: '+27 68 351 0074',
  email: 'sales@voipshop.co.za',
  vatRate: 0.15,
  validityDays: 7,
  // Must be a public HTTPS URL for the server to fetch the image
  logoUrl: 'https://voipshop.co.za/Assets/Group%201642logo%20(1).png'
};

// ---- Utilities ----
const money = (n) =>
  'R ' + Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function withDefaults(input = {}) {
  const company = { ...COMPANY_DEFAULTS, ...(input.company || {}) };
  return {
    quoteNumber: input.quoteNumber || 'Q-' + Date.now(),
    dateISO: input.dateISO || new Date().toISOString().slice(0, 10),
    validDays: Number(company.validityDays || 7),
    client: { ...(input.client || {}) },
    itemsOnceOff: Array.isArray(input.itemsOnceOff) ? input.itemsOnceOff : [],
    itemsMonthly: Array.isArray(input.itemsMonthly) ? input.itemsMonthly : [],
    subtotals: {
      onceOff: Number(input?.subtotals?.onceOff || 0),
      monthly: Number(input?.subtotals?.monthly || 0)
    },
    notes: input.notes || 'PBX system configuration and number setup.',
    company
  };
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

// ---- PDF builder (styled, matching your checkout sections) ----
async function buildQuotePdfBuffer(q) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // Try fetch logo (non-blocking)
  let logoBuf = null;
  try {
    if (q.company.logoUrl) {
      const r = await fetch(q.company.logoUrl, { cache: 'no-store' });
      if (r.ok) logoBuf = Buffer.from(await r.arrayBuffer());
    }
  } catch {}

  // Colors
  const gray500 = '#6b7280';
  const border = '#e5e7eb';
  const band = '#f3f4f6';
  const thbg = '#f9fafb';

  // Header
  if (logoBuf) {
    try { doc.image(logoBuf, 40, 40, { width: 120 }); } catch {}
  }

  doc.font('Helvetica-Bold').fontSize(20).text('Quote', 0, 40, { align: 'right' });
  doc.font('Helvetica').fontSize(10)
     .text(`Quote #: ${q.quoteNumber}`, { align: 'right' })
     .text(`Date: ${q.dateISO}`, { align: 'right' })
     .text(`Valid: ${q.validDays} days`, { align: 'right' });

  // Company & Client blocks
  doc.moveDown(2);
  doc.font('Helvetica-Bold').fontSize(12).text(q.company.name);
  doc.font('Helvetica').fontSize(10)
     .text(q.company.address)
     .text(`${q.company.phone} • ${q.company.email}`);

  doc.moveDown(1.2);
  doc.font('Helvetica-Bold').fontSize(11).text('Bill To');
  doc.font('Helvetica').fontSize(10)
     .text(q.client.name || '')
     .text(q.client.company || '')
     .text(q.client.email || '')
     .text(q.client.phone || '')
     .text(q.client.address || '');

  // Totals pills
  const vat = Number(q.company.vatRate ?? 0.15);
  const onceSub = Number(q.subtotals.onceOff || 0);
  const monSub = Number(q.subtotals.monthly || 0);
  const onceVat = onceSub * vat;
  const monVat = monSub * vat;
  const onceTotal = onceSub + onceVat;
  const monTotal = monSub + monVat;
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

  // Table helper
  function table(title, items, subtotalEx, vatAmt, totalInc, monthly=false) {
    const pageW = doc.page.width;
    const left = doc.page.margins.left;
    const right = pageW - doc.page.margins.right;
    const width = right - left;
    const colW = [ width * 0.58, width * 0.12, width * 0.12, width * 0.18 ];
    let y = doc.y;

    // Title
    doc.font('Helvetica-Bold').fontSize(12).text(title, left, y);
    y = doc.y + 6;

    // Header background
    doc.save()
       .rect(left, y, width, 18)
       .fill(thbg)
       .restore();

    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Description', left + 6, y + 4, { width: colW[0] - 8 });
    doc.text('Qty', left + colW[0], y + 4, { width: colW[1], align: 'right' });
    doc.text('Unit', left + colW[0] + colW[1], y + 4, { width: colW[2], align: 'right' });
    doc.text('Amount', left + colW[0] + colW[1] + colW[2], y + 4, { width: colW[3], align: 'right' });

    // Header bottom border
    doc.moveTo(left, y + 18).lineTo(right, y + 18).strokeColor(border).stroke();
    y += 22;

    doc.font('Helvetica').fontSize(10).fillColor('black');

    // Rows
    if (!items.length) {
      doc.text('No items.', left + 6, y);
      y = doc.y + 6;
    } else {
      for (const it of items) {
        const qty = Number(it.qty || 1);
        const unit = Number(it.unit ?? it.price ?? it.total ?? 0); // allow flexible naming
        const amount = unit * qty;

        // Row border (grid feel)
        doc.moveTo(left, y).lineTo(right, y).strokeColor(border).stroke();

        doc.text(String(it.name || ''), left + 6, y + 6, { width: colW[0] - 8 });
        doc.text(String(qty), left + colW[0], y + 6, { width: colW[1], align: 'right' });
        doc.text(money(unit), left + colW[0] + colW[1], y + 6, { width: colW[2], align: 'right' });
        doc.text(money(amount), left + colW[0] + colW[1] + colW[2], y + 6, { width: colW[3], align: 'right' });

        y += 24;

        // Page break safety
        if (y > doc.page.height - 180) {
          doc.addPage();
          y = doc.y;
        }
      }
    }

    // Footer lines
    doc.moveTo(left, y).lineTo(right, y).strokeColor(border).stroke();
    y += 8;

    const labelW = 120;
    const valW = 90;
    const valX = right - valW;
    const labelX = valX - labelW - 6;

    const line = (label, val) => {
      doc.font('Helvetica').fontSize(10).fillColor('black')
         .text(label, labelX, y, { width: labelW, align: 'right' });
      doc.font('Helvetica-Bold').text(money(val), valX, y, { width: valW, align: 'right' });
      y += 16;
    };

    line('Subtotal', subtotalEx);
    line(`VAT (${Math.round(vat * 100)}%)`, vatAmt);
    line(monthly ? 'Total / month' : 'Total (once-off)', totalInc);

    doc.y = y + 4;
  }

  // Once-off section (hardware & setup)
  table('Once-off Charges', q.itemsOnceOff, onceSub, onceVat, onceTotal, false);
  doc.moveDown(0.8);

  // Monthly section (service)
  table('Monthly Charges', q.itemsMonthly, monSub, monVat, monTotal, true);
  doc.moveDown(1);

  // Grand total band
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;
  const yBand = doc.y + 4;

  doc.save().rect(left, yBand, width, 28).fill(band).restore();
  doc.rect(left, yBand, width, 28).strokeColor(border).stroke();
  doc.font('Helvetica-Bold').fontSize(12)
     .text('Pay now (incl VAT)', left + 10, yBand + 8);
  doc.text(money(grandPayNow), left, yBand + 8, { width, align: 'right' });

  doc.moveDown(3);

  // Included services + call-out fee
  doc.font('Helvetica').fontSize(9).fillColor(gray500)
     .text('Included: Professional install & device setup; Remote support; PBX configuration; Number porting assistance. Standard call-out fee: R450.');
  doc.moveDown(0.6);
  doc.text(`Notes: ${q.notes}`);
  doc.moveDown(0.6);
  doc.text(`This quote is valid for ${q.validDays} days. Pricing in ZAR.`);

  doc.end();
  return done;
}

// ---- Email HTML builders ----
function emailBodyWithLink({ brand, clientName, monthlyInclVat, pdfUrl }) {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial;color:#111;max-width:560px;margin:0 auto;padding:24px;">
      <div style="text-align:center;margin-bottom:16px;">
        ${brand.logoUrl ? `<img src="${brand.logoUrl}" alt="${escapeHtml(brand.name)}" style="height:36px;">` : ''}
      </div>
      <p>Hi ${escapeHtml(clientName || '')},</p>
      <p>Your quote is ready. Your estimated <strong>monthly bill is ${money(monthlyInclVat)}</strong>.</p>
      <p>Click below to download your full PDF quote:</p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${pdfUrl}" style="background:#111;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;display:inline-block;">
          Download Quote (PDF)
        </a>
      </p>
      <p>Just reply if you have any questions.</p>
      <p>— ${escapeHtml(brand.name)} Team</p>
    </div>`;
}

function emailBodyTiny({ brand, clientName, monthlyInclVat }) {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial;color:#111;max-width:560px;margin:0 auto;padding:24px;">
      <div style="text-align:center;margin-bottom:16px;">
        ${brand.logoUrl ? `<img src="${brand.logoUrl}" alt="${escapeHtml(brand.name)}" style="height:36px;">` : ''}
      </div>
      <p>Hi ${escapeHtml(clientName || '')},</p>
      <p>Your quote is ready. Your estimated <strong>monthly bill is ${money(monthlyInclVat)}</strong>.</p>
      <p>The PDF is attached for your records.</p>
      <p>— ${escapeHtml(brand.name)} Team</p>
    </div>`;
}

// ---------------- API handler ----------------
export default async function handler(req, res) {
  // CORS for browser use
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const body = req.body || {};
    const q = withDefaults(body);
    const delivery = (body.delivery || '').toLowerCase() || (process.env.USE_BLOB_LINK ? 'link' : 'attach');

    if (!q?.client?.email) return res.status(400).send('Missing client email.');

    // 1) Generate PDF (fast)
    const pdfBuffer = await buildQuotePdfBuffer(q);

    // 2) Prepare email fields
    const from = 'sales@voipshop.co.za';
    const to = q.client.email;
    const subject = `VoIP Shop Quote • ${q.quoteNumber}`;
    const vat = Number(q.company.vatRate ?? 0.15);
    const monthlyInclVat = Number(q.subtotals.monthly || 0) * (1 + vat);

    if (delivery === 'link') {
      // 3a) Upload to Blob and email a link
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        return res.status(500).send('BLOB_READ_WRITE_TOKEN not set for link delivery.');
      }
      const keyPart = String(q.quoteNumber).replace(/[^\w\-]+/g, '-');
      const objectPath = `quotes/${new Date().toISOString().slice(0,10)}/quote-${keyPart}.pdf`;

      const { url: pdfUrl } = await put(objectPath, pdfBuffer, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        contentType: 'application/pdf',
        addRandomSuffix: false
      });

      const { error } = await resend.emails.send({
        from, to, reply_to: from, subject,
        html: emailBodyWithLink({ brand: q.company, clientName: q.client.name, monthlyInclVat, pdfUrl })
      });
      if (error) throw error;

      return res.status(200).json({ ok: true, delivery: 'link', pdfUrl });
    } else {
      // 3b) Attach directly (fastest path)
      const { error, data } = await resend.emails.send({
        from, to, reply_to: from, subject,
        html: emailBodyTiny({ brand: q.company, clientName: q.client.name, monthlyInclVat }),
        attachments: [
          {
            filename: `Quote-${q.quoteNumber}.pdf`,
            content: pdfBuffer.toString('base64'),
            contentType: 'application/pdf'
          }
        ]
      });
      if (error) throw error;

      return res.status(200).json({ ok: true, delivery: 'attach', id: data?.id });
    }
  } catch (err) {
    console.error('send-quote error', err);
    return res.status(500).send(String(err?.message || err) || 'Failed to create/send quote.');
  }
}
