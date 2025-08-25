// api/send-quote.js
import { Resend } from 'resend';
import { put } from '@vercel/blob';
import PDFDocument from 'pdfkit';
import fetch from 'node-fetch'; // optional if you rely on Node 18 global fetch

// Local file helpers (ESM)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const resend = new Resend(process.env.RESEND_API_KEY);

// ---- Company defaults (override via payload.company) ----
const COMPANY_DEFAULTS = {
  name: 'VoIP Shop',
  address: '23 Lombardy Road, Broadacres, Johannesburg',
  phone: '+27 68 351 0074',
  email: 'sales@voipshop.co.za',
  vatRate: 0.15,
  validityDays: 7,
  // Public URL only used inside the EMAIL HTML (optional). PDF uses local logo loader below.
  logoUrl: ''
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

// Prefer local logo; fallback to remote if provided
async function loadLogoBuffer(overrideUrl = '') {
  // Your file lives at repo-root/Assets/Group 1642logo (1).png
  const localCandidates = [
    path.resolve(__dirname, '../Assets/Group 1642logo (1).png'),
    path.resolve(__dirname, '../../Assets/Group 1642logo (1).png')
  ];
  for (const p of localCandidates) {
    try {
      const buf = await fs.readFile(p);
      if (buf?.length) return buf;
    } catch {}
  }
  try {
    const url = overrideUrl || '';
    if (url && /^https?:\/\//i.test(url)) {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    }
  } catch {}
  return null;
}

// ---- PDF builder (refined layout) ----
async function buildQuotePdfBuffer(q) {
  const doc = new PDFDocument({ size: 'A4', margin: 46 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // Load logo (local → remote)
  const logoBuf = await loadLogoBuffer(q.company.logoUrl);

  // Brand palette
  const brand = '#0071E3'; // Apple-ish blue
  const ink   = '#0f172a'; // slate-900
  const gray6 = '#475569'; // slate-600
  const gray4 = '#94a3b8'; // slate-400
  const line  = '#e5e7eb'; // gray-200
  const thbg  = '#f8fafc'; // slate-50
  const pill  = '#f1f5f9'; // slate-100

  // Top band
  doc.save().rect(0, 0, doc.page.width, 6).fill(brand).restore();

  // Header content
  const headerTop = 22;
  if (logoBuf) {
    try { doc.image(logoBuf, doc.page.margins.left, headerTop, { width: 150 }); } catch {}
  }

  const datePretty = (() => {
    try { return new Date(q.dateISO).toISOString().slice(0, 10); } catch { return String(q.dateISO || '').slice(0, 10); }
  })();

  doc
    .font('Helvetica-Bold').fontSize(22).fillColor(ink)
    .text('Quote', 0, headerTop, { align: 'right' })
    .moveDown(0.2);

  doc.font('Helvetica').fontSize(10).fillColor(gray6)
    .text(`Quote #: ${q.quoteNumber}`, { align: 'right' })
    .text(`Date: ${datePretty}`,       { align: 'right' })
    .text(`Valid: ${Number(q.validDays || 7)} days`, { align: 'right' });

  // Company block
  doc.moveDown(2);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(ink).text(q.company.name);
  doc.font('Helvetica').fontSize(10).fillColor(gray6)
    .text(q.company.address)
    .text(`${q.company.phone} • ${q.company.email}`);

  // Client block
  doc.moveDown(1.2);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(ink).text('Bill To');
  doc.font('Helvetica').fontSize(10).fillColor(ink)
    .text(q.client.name || '')
    .text(q.client.company || '')
    .text(q.client.email || '')
    .text(q.client.phone || '')
    .text(q.client.address || '');

  // Totals (compute once)
  const vat = Number(q.company.vatRate ?? 0.15);
  const onceSub = Number(q.subtotals.onceOff || 0);
  const monSub  = Number(q.subtotals.monthly || 0);
  const onceVat = onceSub * vat;
  const monVat  = monSub * vat;
  const onceTotal = onceSub + onceVat;
  const monTotal  = monSub + monVat;
  const grandPayNow = onceTotal + monTotal;

  // Totals “cards”
  const yStart = doc.y + 14;
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;

  function card(x, y, w, h, title, value, subtitle) {
    doc.save().roundedRect(x, y, w, h, 10).fill(pill).restore();
    doc.roundedRect(x, y, w, h, 10).strokeColor(line).stroke();

    doc.font('Helvetica').fontSize(9).fillColor(gray6).text(title, x + 12, y + 7);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(ink).text(value, x + 12, y + 19);
    if (subtitle) {
      doc.font('Helvetica').fontSize(9).fillColor(gray6)
        .text(subtitle, x + w - 70, y + 21, { width: 60, align: 'right' });
    }
  }

  const cardW = (right - left - 12) / 2;
  card(left, yStart, cardW, 40, 'MONTHLY', money(monTotal), '/month');
  card(left + cardW + 12, yStart, cardW, 40, 'ONCE-OFF', money(onceTotal), 'setup');

  doc.moveDown(4);

  // Table helper with zebra rows & crisp totals
  function table(title, items, subtotalEx, vatAmt, totalInc, monthly = false) {
    const pageW = doc.page.width;
    const L = doc.page.margins.left;
    const R = pageW - doc.page.margins.right;
    const W = R - L;
    const colW = [ W * 0.58, W * 0.12, W * 0.12, W * 0.18 ];
    let y = doc.y;

    doc.font('Helvetica-Bold').fontSize(12).fillColor(ink).text(title, L, y);
    y = doc.y + 6;

    // header row
    doc.save().rect(L, y, W, 20).fill(thbg).restore();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(ink);
    doc.text('Description', L + 8, y + 5, { width: colW[0] - 10 });
    doc.text('Qty',         L + colW[0], y + 5, { width: colW[1], align: 'right' });
    doc.text('Unit',        L + colW[0] + colW[1], y + 5, { width: colW[2], align: 'right' });
    doc.text('Amount',      L + colW[0] + colW[1] + colW[2], y + 5, { width: colW[3], align: 'right' });

    doc.moveTo(L, y + 20).lineTo(R, y + 20).strokeColor(line).stroke();
    y += 22;

    doc.font('Helvetica').fontSize(10).fillColor(ink);

    const zebra = ['#ffffff', '#fbfdff'];
    let rowIndex = 0;

    if (!items.length) {
      doc.text('No items.', L + 8, y);
      y = doc.y + 6;
    } else {
      for (const it of items) {
        const qty    = Number(it.qty || 1);
        const unit   = Number(it.unit ?? it.price ?? it.total ?? 0);
        const amount = unit * qty;

        // zebra bg
        doc.save().rect(L, y, W, 24).fill(zebra[rowIndex % 2]).restore();
        rowIndex++;

        doc.text(String(it.name || ''), L + 8, y + 6, { width: colW[0] - 10 });
        doc.text(String(qty),           L + colW[0], y + 6, { width: colW[1], align: 'right' });
        doc.text(money(unit),           L + colW[0] + colW[1], y + 6, { width: colW[2], align: 'right' });
        doc.text(money(amount),         L + colW[0] + colW[1] + colW[2], y + 6, { width: colW[3], align: 'right' });

        y += 24;

        // page break safety
        if (y > doc.page.height - 160) {
          doc.addPage();
          y = doc.y;
        }
      }
    }

    // table totals
    doc.moveTo(L, y).lineTo(R, y).strokeColor(line).stroke();
    y += 10;

    const labelW = 140;
    const valW   = 110;
    const valX   = R - valW;
    const labelX = valX - labelW - 8;

    function totalLine(label, val, bold = false) {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(bold ? ink : gray6)
        .text(label, labelX, y, { width: labelW, align: 'right' });
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(ink)
        .text(money(val), valX, y, { width: valW, align: 'right' });
      y += 16;
    }

    totalLine('Subtotal', subtotalEx);
    totalLine(`VAT (${Math.round(vat * 100)}%)`, vatAmt);
    totalLine(monthly ? 'Total / month' : 'Total (once-off)', totalInc, true);

    doc.y = y + 6;
  }

  // Sections
  table('Once-off Charges', q.itemsOnceOff, onceSub, onceVat, onceTotal, false);
  doc.moveDown(0.8);
  table('Monthly Charges', q.itemsMonthly, monSub, monVat, monTotal, true);
  doc.moveDown(1.2);

  // Grand total band
  const L2 = doc.page.margins.left;
  const R2 = doc.page.width - doc.page.margins.right;
  const W2 = R2 - L2;
  const yBand = doc.y + 4;

  doc.save().roundedRect(L2, yBand, W2, 32, 8).fill(pill).restore();
  doc.roundedRect(L2, yBand, W2, 32, 8).strokeColor(line).stroke();
  doc.font('Helvetica-Bold').fontSize(12).fillColor(ink)
    .text('Pay now (incl VAT)', L2 + 12, yBand + 9);
  doc.text(money(grandPayNow), L2, yBand + 9, { width: W2 - 12, align: 'right' });

  doc.moveDown(2.2);

  // Notes
  doc.font('Helvetica').fontSize(9).fillColor(gray6)
    .text('Included: Professional install & device setup; Remote support; PBX configuration; Number porting assistance. Standard call-out fee: R450.');
  doc.moveDown(0.6);
  doc.text(`Notes: ${q.notes || ''}`);
  doc.moveDown(0.6);
  doc.text(`This quote is valid for ${Number(q.validDays || 7)} days. Pricing in ZAR.`);

  // Footer page numbers
  const addFooter = () => {
    const y = doc.page.height - 30;
    const x = doc.page.margins.left;
    const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc.font('Helvetica').fontSize(9).fillColor(gray4)
      .text(`VoIP Shop • ${q.company.email} • ${q.company.phone}`, x, y, { width: w, align: 'left' })
      .text(`Page ${doc.page.number}`, x, y, { width: w, align: 'right' });
  };
  addFooter();
  doc.on('pageAdded', addFooter);

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

// ---------------- API handler (with PREVIEW mode) ----------------
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Preview flag: works for GET ?preview=1 or POST {preview:true}
  const isPreview =
    req.method === 'GET'
      ? (req.query?.preview === '1' || req.query?.preview === 'true')
      : (req.body?.preview === true || req.body?.preview === '1' || req.query?.preview === '1');

  try {
    // For GET preview, we accept no body and just use defaults
    const body = req.method === 'POST' ? (req.body || {}) : {};
    const q = withDefaults(body);

    // Generate PDF once
    const pdfBuffer = await buildQuotePdfBuffer(q);

    if (isPreview) {
      // Return the PDF inline in the browser — no email is sent
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename=Quote-${q.quoteNumber}.pdf`);
      return res.status(200).send(pdfBuffer);
    }

    // From here on, it's the normal email flow (POST only)
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const delivery = (body.delivery || '').toLowerCase() || (process.env.USE_BLOB_LINK ? 'link' : 'attach');
    if (!q?.client?.email) return res.status(400).send('Missing client email.');

    const from = 'sales@voipshop.co.za';
    const to = q.client.email;
    const subject = `VoIP Shop Quote • ${q.quoteNumber}`;
    const vat = Number(q.company.vatRate ?? 0.15);
    const monthlyInclVat = Number(q.subtotals.monthly || 0) * (1 + vat);

    if (delivery === 'link') {
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
      const { error, data } = await resend.emails.send({
        from, to, reply_to: from, subject,
        html: emailBodyTiny({ brand: q.company, clientName: q.client.name, monthlyInclVat }),
        attachments: [
          { filename: `Quote-${q.quoteNumber}.pdf`, content: pdfBuffer.toString('base64'), contentType: 'application/pdf' }
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
