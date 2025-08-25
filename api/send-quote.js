// api/send-quote.js
import { Resend } from 'resend';
import { put } from '@vercel/blob';
import PDFDocument from 'pdfkit';

// Local file helpers (ESM)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const resend = new Resend(process.env.RESEND_API_KEY);

/* =======================================================================================
   COMPANY DEFAULTS
   ======================================================================================= */
const COMPANY_DEFAULTS = {
  name: 'VoIP Shop',
  address: '23 Lombardy Road, Broadacres, Johannesburg',
  phone: '+27 68 351 0074',
  email: 'sales@voipshop.co.za',
  vatRate: 0.15,
  validityDays: 7,
  // Public HTTPS (email HTML only). PDF uses buffer loader below.
  logoUrl: 'https://voipshop.co.za/Assets/Group%201642logo%20(1).png',
  // Brand accents (override per request if needed)
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

/* =======================================================================================
   UTILITIES
   ======================================================================================= */
const money = (n) =>
  'R ' + Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function withDefaults(input = {}) {
  const company = { ...COMPANY_DEFAULTS, ...(input.company || {}) };
  if (!company.colors) company.colors = COMPANY_DEFAULTS.colors;

  // Defensive coercion of line items
  const norm = (arr = []) =>
    Array.isArray(arr)
      ? arr.map((it) => ({
          name: String(it.name ?? it.desc ?? ''),
          qty: Number(it.qty ?? it.quantity ?? 1),
          unit: Number(it.unit ?? it.price ?? 0),
          minutes: it.minutes ?? it.includedMinutes
        }))
      : [];

  return {
    quoteNumber: input.quoteNumber || 'Q-' + Date.now(),
    dateISO: input.dateISO || new Date().toISOString().slice(0, 10),
    validDays: Number(input.validDays ?? company.validityDays ?? 7),
    client: { ...(input.client || {}) },
    itemsOnceOff: norm(input.itemsOnceOff),
    itemsMonthly: norm(input.itemsMonthly),
    subtotals: {
      onceOff: Number(input?.subtotals?.onceOff || 0),
      monthly: Number(input?.subtotals?.monthly || 0)
    },
    notes: input.notes || 'PBX system configuration and number setup.',
    stamp: input.stamp || '', // e.g. 'DRAFT' or 'PAID'
    compact: !!input.compact,
    company
  };
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

// Prefer local logo; fallback to remote if provided (works on Vercel Node 18/20+)
async function loadLogoBuffer(overrideUrl = '') {
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
    if (url && typeof fetch === 'function') {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    }
  } catch {}
  return null;
}

/* =======================================================================================
   PDF BUILDER (clean layout, tables, summary cards, pay-now band, footer numbers)
   ======================================================================================= */
async function buildQuotePdfBuffer(q) {
  const compact = !!q.compact;

  // Page + margins
  const margin = compact ? 40 : 46;
  const doc = new PDFDocument({ size: 'A4', margin });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // Bounds
  const L = doc.page.margins.left;
  const R = doc.page.width - doc.page.margins.right;
  const W = R - L;

  // Brand palette
  const { brand, ink, gray6, gray4, line, thbg, pill } = q.company.colors;

  // Optional watermark/stamp (e.g. DRAFT/PAID)
  const paintStamp = (text) => {
    if (!text) return;
    doc.save();
    doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font('Helvetica-Bold').fontSize(90).fillColor('#EEF2FF').opacity(0.7)
       .text(text, doc.page.width * 0.1, doc.page.height * 0.25, {
         width: doc.page.width * 0.8,
         align: 'center'
       });
    doc.opacity(1).restore();
  };

  // Top brand hairline
  doc.save().rect(0, 0, doc.page.width, 6).fill(brand).restore();

  // Header
  const headerTop = 22;
  const logoBuf = await loadLogoBuffer(q.company.logoUrl);
  if (logoBuf) {
    try { doc.image(logoBuf, L, headerTop, { width: compact ? 130 : 150 }); } catch {}
  } else {
    doc.font('Helvetica-Bold').fontSize(16).fillColor(ink).text(q.company.name, L, headerTop);
  }

  const datePretty = (() => {
    try { return new Date(q.dateISO).toISOString().slice(0, 10); } catch { return String(q.dateISO || '').slice(0, 10); }
  })();

  doc
    .font('Helvetica-Bold').fontSize(compact ? 20 : 22).fillColor(ink)
    .text('Quote', L, headerTop, { width: W, align: 'right' })
    .moveDown(0.2);

  doc.font('Helvetica').fontSize(10).fillColor(gray6)
    .text(`Quote #: ${q.quoteNumber}`, L, undefined, { width: W, align: 'right' })
    .text(`Date: ${datePretty}`,       L, undefined, { width: W, align: 'right' })
    .text(`Valid: ${Number(q.validDays || 7)} days`, L, undefined, { width: W, align: 'right' });

  // Company block
  doc.moveDown(compact ? 1.5 : 2);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(ink).text(q.company.name, L, undefined, { width: W });
  doc.font('Helvetica').fontSize(10).fillColor(gray6)
    .text(q.company.address, L, undefined, { width: W })
    .text(`${q.company.phone} • ${q.company.email}`, L, undefined, { width: W });

  // Client block
  doc.moveDown(compact ? 1.0 : 1.2);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(ink).text('Bill To', L, undefined, { width: W });
  doc.font('Helvetica').fontSize(10).fillColor(ink)
    .text(q.client.name || '', L, undefined, { width: W })
    .text(q.client.company || '', L, undefined, { width: W })
    .text(q.client.email || '', L, undefined, { width: W })
    .text(q.client.phone || '', L, undefined, { width: W })
    .text(q.client.address || '', L, undefined, { width: W });

  // Totals (compute once)
  const vatRate = Number(q.company.vatRate ?? 0.15);
  const onceSub = Number(q.subtotals.onceOff || 0);
  const monSub  = Number(q.subtotals.monthly || 0);
  const onceVat = onceSub * vatRate;
  const monVat  = monSub * vatRate;
  const onceTotal = onceSub + onceVat;
  const monTotal  = monSub + monVat;
  const grandPayNow = onceTotal + monTotal;

  // Summary cards
  const yStart = doc.y + (compact ? 10 : 14);
  const gap = 12;
  const cardH = compact ? 44 : 48;
  const cardW = (W - gap) / 2;

  const card = (x, y, w, h, title, value, subtitle) => {
    doc.save().roundedRect(x, y, w, h, 12).fill(pill).restore();
    doc.roundedRect(x, y, w, h, 12).strokeColor(line).stroke();
    doc.font('Helvetica').fontSize(9).fillColor(gray6).text(title, x + 12, y + 8);
    doc.font('Helvetica-Bold').fontSize(compact ? 13 : 14).fillColor(ink).text(value, x + 12, y + 22);
    if (subtitle) {
      doc.font('Helvetica').fontSize(9).fillColor(gray6)
        .text(subtitle, x + w - 70, y + 22, { width: 60, align: 'right' });
    }
  };
  card(L, yStart, cardW, cardH, 'MONTHLY', money(monTotal), '/month');
  card(L + cardW + gap, yStart, cardW, cardH, 'ONCE-OFF', money(onceTotal), 'setup');

  doc.y = yStart + cardH + (compact ? 12 : 16);

  const unitText = (it, monthly) => {
    const looksLikeCalls = /call|minute/i.test(it.name);
    const minutes = it.minutes;
    if (monthly && (minutes != null || looksLikeCalls)) {
      const m = Number(minutes) || 0;
      return m > 0 ? `${m} minutes` : 'Included minutes';
    }
    return money(it.unit);
  };

  // Generic table renderer
  const table = (title, items, subtotalEx, vatAmt, totalInc, monthly = false) => {
    const colW = [ W * 0.58, W * 0.12, W * 0.12, W * 0.18 ];
    const rowH = compact ? 20 : 24;
    const headH = compact ? 18 : 20;
    let y = doc.y;

    // Section title
    doc.font('Helvetica-Bold').fontSize(12).fillColor(ink).text(title, L, y, { width: W });
    y = doc.y + (compact ? 4 : 6);

    // Header row
    doc.save().rect(L, y, W, headH).fill(thbg).restore();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(ink);
    const headY = y + (compact ? 3 : 5);
    doc.text('Description', L + 8, headY, { width: colW[0] - 10 });
    doc.text('Qty',         L + colW[0], headY, { width: colW[1], align: 'right' });
    doc.text('Unit',        L + colW[0] + colW[1], headY, { width: colW[2], align: 'right' });
    doc.text('Amount',      L + colW[0] + colW[1] + colW[2], headY, { width: colW[3], align: 'right' });

    doc.moveTo(L, y + headH).lineTo(R, y + headH).strokeColor(line).stroke();
    y += headH + 2;

    // Body
    doc.font('Helvetica').fontSize(10).fillColor(ink);
    const zebra = ['#ffffff', '#fbfdff'];
    let rowIndex = 0;

    const ensureSpace = (need = 140) => {
      if (y > doc.page.height - need) {
        doc.addPage();
        paintStamp(q.stamp);
        y = doc.y;
      }
    };

    if (!items.length) {
      ensureSpace(120);
      doc.text('No items.', L + 8, y, { width: W - 16 });
      y = doc.y + 6;
    } else {
      for (const it of items) {
        ensureSpace(160);
        const qty    = Number(it.qty || 1);
        const amount = it.unit * qty;

        // Zebra background
        doc.save().rect(L, y, W, rowH).fill(zebra[rowIndex % 2]).restore();
        rowIndex++;

        const rowTextY = y + (compact ? 4 : 6);
        doc.text(String(it.name || ''), L + 8, rowTextY, { width: colW[0] - 10 });
        doc.text(String(qty),           L + colW[0], rowTextY, { width: colW[1], align: 'right' });
        doc.text(unitText(it, monthly), L + colW[0] + colW[1], rowTextY, { width: colW[2], align: 'right' });
        doc.text(money(amount),         L + colW[0] + colW[1] + colW[2], rowTextY, { width: colW[3], align: 'right' });

        y += rowH;
      }
    }

    // Totals
    doc.moveTo(L, y).lineTo(R, y).strokeColor(line).stroke();
    y += compact ? 8 : 10;

    const labelW = compact ? 130 : 140;
    const valW   = compact ? 110 : 120;
    const valX   = R - valW;
    const labelX = valX - labelW - 8;

    const totalLine = (label, val, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(bold ? ink : gray6)
        .text(label, labelX, y, { width: labelW, align: 'right' });
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(ink)
        .text(money(val), valX, y, { width: valW, align: 'right' });
      y += compact ? 14 : 16;
    };

    totalLine('Subtotal', subtotalEx);
    totalLine(`VAT (${Math.round(vatRate * 100)}%)`, vatAmt);
    totalLine(monthly ? 'Total / month' : 'Total (once-off)', totalInc, true);

    doc.y = y + (compact ? 4 : 6);
  };

  // Paint optional page stamp first page
  paintStamp(q.stamp);

  // Sections
  table('Once-off Charges', q.itemsOnceOff, onceSub, onceVat, onceTotal, false);
  doc.moveDown(compact ? 0.6 : 0.8);
  table('Monthly Charges', q.itemsMonthly, monSub, monVat, monTotal, true);
  doc.moveDown(compact ? 1.0 : 1.2);

  // Pay-now band
  const yBand = doc.y + 4;
  const bandH = compact ? 30 : 34;
  doc.save().roundedRect(L, yBand, W, bandH, 10).fill(pill).restore();
  doc.roundedRect(L, yBand, W, bandH, 10).strokeColor(line).stroke();
  doc.font('Helvetica-Bold').fontSize(12).fillColor(ink)
    .text('Pay now (incl VAT)', L + 12, yBand + (compact ? 7 : 9));
  doc.text(money(grandPayNow), L, yBand + (compact ? 7 : 9), { width: W - 12, align: 'right' });

  doc.moveDown(compact ? 1.6 : 2.0);

  // Notes / Included (wrapped)
  const blurb = [
    'Included: Professional install & device setup; Remote support; PBX configuration; Number porting assistance. Standard call-out fee: R450.',
    q.notes ? `Notes: ${q.notes}` : '',
    `This quote is valid for ${Number(q.validDays || 7)} days. Pricing in ZAR.`
  ].filter(Boolean).join('\n');

  doc.font('Helvetica').fontSize(9).fillColor(gray6)
     .text(blurb, L, undefined, { width: W });

  // Footer with page numbers + contact
  const addFooter = () => {
    const y = doc.page.height - 30;
    doc.font('Helvetica').fontSize(9).fillColor(gray4)
      .text(`${q.company.name} • ${q.company.email} • ${q.company.phone}`, L, y, { width: W, align: 'left' })
      .text(`Page ${doc.page.number}`, L, y, { width: W, align: 'right' });
  };
  addFooter();
  doc.on('pageAdded', () => {
    paintStamp(q.stamp);
    addFooter();
  });

  doc.end();
  return done;
}

/* =======================================================================================
   EMAIL HTML (two variants)
   ======================================================================================= */
function emailBodyWithLink({ brand, clientName, monthlyInclVat, pdfUrl }) {
  const preheader = `Your VoIP Shop quote is ready — monthly est. ${money(monthlyInclVat)}`;
  return `
  <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">
    ${escapeHtml(preheader)}
  </div>
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial;color:#111;max-width:560px;margin:0 auto;padding:24px;">
    <div style="text-align:center;margin-bottom:16px;">
      ${brand.logoUrl ? `<img src="${brand.logoUrl}" alt="${escapeHtml(brand.name)}" style="height:36px;">` : ''}
    </div>
    <p>Hi ${escapeHtml(clientName || '')},</p>
    <p>Your quote is ready. Your estimated <strong>monthly bill is ${money(monthlyInclVat)}</strong>.</p>
    <p>Click below to download your PDF quote:</p>
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
  const preheader = `Your VoIP Shop quote is ready — monthly est. ${money(monthlyInclVat)}`;
  return `
  <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">
    ${escapeHtml(preheader)}
  </div>
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

/* =======================================================================================
   API HANDLER
   - GET or ?preview=1: inline PDF preview
   - POST + client.email: sends via Resend (attach or link via Blob)
   - Supports ?compact=1 and body.compact
   - Optional body.stamp = 'DRAFT' | 'PAID' to watermark
   ======================================================================================= */
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Flags
  const explicitPreview =
    (req.query?.preview === '1' || req.query?.preview === 'true') ||
    (req.body?.preview === true || req.body?.preview === '1');
  const compactFlag =
    (req.query?.compact === '1' || req.query?.compact === 'true') ||
    (req.body?.compact === true || req.body?.compact === '1');

  const body = req.method === 'POST' ? (req.body || {}) : {};
  const base = withDefaults({ ...body, compact: compactFlag });

  // Decide preview vs email
  const noEmail = !base?.client?.email;
  const isPreview = explicitPreview || req.method === 'GET' || noEmail;

  try {
    // Build PDF buffer
    const pdfBuffer = await buildQuotePdfBuffer(base);

    if (isPreview) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename=Quote-${base.quoteNumber}.pdf`);
      return res.status(200).send(pdfBuffer);
    }

    // ---- Normal email flow (POST + has client.email) ----
    const delivery =
      (body.delivery || '').toLowerCase() ||
      (process.env.USE_BLOB_LINK ? 'link' : 'attach');

    const from = 'sales@voipshop.co.za';
    const to = base.client.email;
    const subject = `VoIP Shop Quote • ${base.quoteNumber}`;
    const monthlyInclVat = Number(base.subtotals.monthly || 0) * (1 + Number(base.company.vatRate ?? 0.15));

    if (delivery === 'link') {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        console.error('Missing BLOB_READ_WRITE_TOKEN for link delivery');
        return res.status(500).send('BLOB_READ_WRITE_TOKEN not set for link delivery.');
      }
      const keyPart = String(base.quoteNumber).replace(/[^\w\-]+/g, '-');
      const objectPath = `quotes/${new Date().toISOString().slice(0,10)}/quote-${keyPart}.pdf`;

      const { url: pdfUrl } = await put(objectPath, pdfBuffer, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        contentType: 'application/pdf',
        addRandomSuffix: false
      });

      const { error } = await resend.emails.send({
        from, to, reply_to: from, subject,
        html: emailBodyWithLink({ brand: base.company, clientName: base.client.name, monthlyInclVat, pdfUrl })
      });
      if (error) {
        console.error('Resend send error (link):', error);
        return res.status(502).send('Email send failed: ' + (error?.message || 'unknown'));
      }
      return res.status(200).json({ ok: true, delivery: 'link', pdfUrl });
    } else {
      const { error, data } = await resend.emails.send({
        from, to, reply_to: from, subject,
        html: emailBodyTiny({ brand: base.company, clientName: base.client.name, monthlyInclVat }),
        attachments: [
          { filename: `Quote-${base.quoteNumber}.pdf`, content: pdfBuffer.toString('base64'), contentType: 'application/pdf' }
        ]
      });
      if (error) {
        console.error('Resend send error (attach):', error);
        return res.status(502).send('Email send failed: ' + (error?.message || 'unknown'));
      }
      return res.status(200).json({ ok: true, delivery: 'attach', id: data?.id });
    }
  } catch (err) {
    console.error('send-quote error', err);
    return res.status(500).send(String(err?.message || err) || 'Failed to create/send quote.');
  }
}
