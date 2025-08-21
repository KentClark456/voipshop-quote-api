import { Resend } from 'resend';
import PDFDocument from 'pdfkit';

// Initialize Resend with your API key from Vercel env vars
const resend = new Resend(process.env.RESEND_API_KEY);

function zar(amount) {
  const n = Number(amount || 0);
  return 'R ' + n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function generatePdfBuffer(quote) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const {
      quoteNumber, dateISO, company = {}, client = {},
      itemsOnceOff = [], itemsMonthly = [], subtotals = {}, notes = ''
    } = quote;

    const dateStr = new Date(dateISO || Date.now()).toLocaleDateString('en-ZA');

    // Header
    doc.fontSize(18).text('Quotation', { continued: true })
       .fontSize(10).fillColor('#666').text(`   ${quoteNumber || ''}`);
    doc.moveDown(0.5).fillColor('#000').fontSize(11)
       .text(company.name || 'Darkwire')
       .text(company.address || '')
       .text(`Tel: ${company.phone || ''}  |  Email: ${company.email || ''}`)
       .text(company.reg ? `Reg: ${company.reg}` : '');

    doc.moveDown().fontSize(10).fillColor('#666')
       .text(`Date: ${dateStr}`)
       .text(`Valid for: ${company.validityDays ?? 7} days`);

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

    // Totals
    const vatRate = Number(company.vatRate ?? 0.15);
    const vatOnce = (subtotals.onceOff || 0) * vatRate;
    const vatMonthly = (subtotals.monthly || 0) * vatRate;
    const totalOnce = (subtotals.onceOff || 0) + vatOnce;
    const totalMonthly = (subtotals.monthly || 0) + vatMonthly;

    doc.moveDown().moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#e5e7eb').stroke();
    doc.moveDown().fontSize(12).text('Totals', { underline: true });
    doc.moveDown(0.2).fontSize(11)
       .text(`Once-off VAT (${vatRate * 100}%)`, { continued: true }).text(zar(vatOnce), { align: 'right' })
       .text('Once-off Total (incl VAT)', { continued: true }).text(zar(totalOnce), { align: 'right' })
       .moveDown(0.3)
       .text(`Monthly VAT (${vatRate * 100}%)`, { continued: true }).text(zar(vatMonthly), { align: 'right' })
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  try {
    const quote = req.body;
    if (!quote?.client?.email) return res.status(400).send('Missing client email.');

    // Generate PDF
    const pdf = await generatePdfBuffer(quote);

    // Send email via Resend
    await resend.emails.send({
      from: 'quotes@yourdomain.com', // must be a verified sender/domain in Resend
      to: quote.client.email,
      subject: `Your Quote ${quote.quoteNumber ? `• ${quote.quoteNumber}` : ''}`,
      html: `<p>Hi ${quote.client.name || ''},</p>
             <p>Please find your attached quote.</p>
             <p>Regards,<br/>Darkwire</p>`,
      attachments: [
        {
          filename: `Quote-${quote.quoteNumber || 'Darkwire'}.pdf`,
          content: pdf.toString('base64'),
          type: 'application/pdf'
        }
      ]
    });

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).send(e.message || 'Failed to send quote.');
  }
}
