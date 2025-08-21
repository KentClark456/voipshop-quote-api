import { Resend } from 'resend';
import PDFDocument from 'pdfkit';

const resend = new Resend(process.env.RESEND_API_KEY);

/* ====== VoIP Shop defaults (edit once, apply everywhere) ====== */
const COMPANY_DEFAULTS = {
  name: 'VoIP Shop',
  address: '23 Lombardy Road, Lombardy East, Johannesburg, 2090',
  phone: '068 351 0074',
  email: 'sales@voipshop.co.za',
  reg: 'Reg: 2019/123456/07',
  vatRate: 0.15,
  validityDays: 7,
  bank: `Bank: Capitec
Account Name: VoIP Shop (Pty) Ltd
Account No: 2100282464
Branch Code: 470010
Ref: Quote Number`
};

/* ---------- helpers ---------- */
function zar(amount) {
  const n = Number(amount || 0);
  return 'R ' + n.toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function withDefaults(input = {}) {
  // Merge provided quote with defaults (provided fields win)
  const company = { ...COMPANY_DEFAULTS, ...(input.company || {}) };
  const client = { ...(input.client || {}) };

  return {
    quoteNumber: input.quoteNumber || 'QUOTE',
    dateISO: input.dateISO || new Date().toISOString(),
    company,
    client,
    itemsOnceOff: Array.isArray(input.itemsOnceOff) ? input.itemsOnceOff : [],
    itemsMonthly: Array.isArray(input.itemsMonthly) ? input.itemsMonthly : [],
    subtotals: {
      onceOff: Number(input?.subtotals?.onceOff || 0),
      monthly: Number(input?.subtotals?.monthly || 0)
    },
    notes: input.notes || ''
  };
}

function generatePdfBuffer(quoteInput) {
  return new Promise((resolve, reject) => {
    const q = withDefaults(quoteInput);
    const {
      quoteNumber, dateISO, company, client,
      itemsOnceOff, itemsMonthly, subtotals, notes
    } = q;

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const dateStr = new Date(dateISO).toLocaleDateString('en-ZA');

    // Header
    doc.fontSize(18).text('Quotation', { continued: true })
       .fontSize(10).fillColor('#666').text(`   ${quoteNumber || ''}`);
    doc.moveDown(0.5).fillColor('#000').fontSize(11)
       .text(company.name)
       .text(company.address)
       .text(`Tel: ${company.phone}  |  Email: ${company.email}`)
       .text(company.reg || '');

    doc.moveDown().fontSize(10).fillColor('#666')
       .text(`Date: ${dateStr}`)
       .text(`Valid for: ${company.validityDays} days`);

    doc.moveDown().fillColor('#000').fontSize(12).text('Bill To:', { underline: true });
    doc.fontSize(11).text(client.name || '').text(client.email || '').text(client.phone || '');

    // Divider
    doc.moveDown().moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#e5e7eb').stroke();

    // Once-off
    if (itemsOnceOff.length) {
      doc.moveDown().fontSize(12).text('Once-off Charges', { underline: true });
      doc.moveDown(0.2).fontSize(10);
      itemsOnceOff.forEach((it) => {
        const name = `${it.name || ''}${it.qty ? `  x${it.qty}` : ''}`;
        doc.text(name, 40, doc.y, { continued: true }).text(zar(it.total || 0), { align: 'right' });
      });
      doc.moveDown(0.2).fontSize(11)
         .text('Subtotal (ex VAT)', { continued: true })
         .text(zar(subtotals.onceOff || 0), { align: 'right' });
    }

    // Monthly
    if (itemsMonthly.length) {
      doc.moveDown().fontSize(12).text('Monthly Charges', { underline: true });
      doc.moveDown(0.2).fontSize(10);
      itemsMonthly.forEach((it) => {
        const name = `${it.name || ''}${it.qty ? `  x${it.qty}` : ''}`;
        doc.text(name, 40, doc.y, { continued: true }).text(zar(it.total || 0), { align: 'right' });
      });
      doc.moveDown(0.2).fontSize(11)
         .text('Subtotal (ex VAT)', { continued: true })
         .text(zar(subtotals.monthly || 0), { align: 'right' });
    }

    // Totals (with default VAT fallback)
    const vatRate = Number(company.vatRate ?? COMPANY_DEFAULTS.vatRate);
    const vatOnce = (subtotals.onceOff || 0) * vatRate;
    const vatMonthly = (subtotals.monthly || 0) * vatRate;
    const totalOnce = (subtotals.onceOff || 0) + vatOnce;
    const totalMonthly = (subtotals.monthly || 0) + vatMonthly;

    doc.moveDown().moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#e5e7eb').stroke();
    doc.moveDown().fontSize(12).text('Totals', { underline: true });
    doc.moveDown(0.2).fontSize(11)
       .text(`Once-off VAT (${Math.round(vatRate * 100)}%)`, { continued: true }).text(zar(vatOnce), { align: 'right' })
       .text('Once-off Total (incl VAT)', { continued: true }).text(zar(totalOnce), { align: 'right' })
       .moveDown(0.3)
       .text(`Monthly VAT (${Math.round(vatRate * 100)}%)`, { continued: true }).text(zar(vatMonthly), { align: 'right' })
       .text('Monthly Total (incl VAT)', { continued: true }).text(zar(totalMonthly), { align: 'right' });

    if (notes) {
      doc.moveDown().fontSize(10).fillColor('#444').text(notes, { width: 515 });
    }
    if (company.bank) {
      doc.moveDown().fontSize(10).fillColor('#000').text('Banking Details:', { underline: true });
      doc.fontSize(10).fillColor('#333').text(company.bank);
    }

    doc.end();
  });
}

/* ---------- API handler ---------- */
export default async function handler(req, res) {
  // CORS for browser calls
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const q = withDefaults(req.body || {});
    if (!q?.client?.email) return res.status(400).send('Missing client email.');

    // Generate PDF using merged defaults
    const pdf = await generatePdfBuffer(q);

    // Send email via Resend
    await resend.emails.send({
      from: 'sales@voipshop.co.za', // must be verified in Resend
      to: q.client.email,
      subject: `VoIP Shop Quote ${q.quoteNumber ? `• ${q.quoteNumber}` : ''}`,
      html: `<p>Hi ${q.client.name || ''},</p>
             <p>Please find your attached quote from <strong>VoIP Shop</strong>.</p>
             <p>Regards,<br/>VoIP Shop</p>`,
      attachments: [
        {
          filename: `Quote-${q.quoteNumber || 'VoIP-Shop'}.pdf`,
          content: pdf.toString('base64'),
          contentType: 'application/pdf'
        }
      ]
    });

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).send(e.message || 'Failed to send quote.');
  }
}

