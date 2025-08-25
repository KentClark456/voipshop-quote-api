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

// ---- Company defaults (override via payload.company) ----
const COMPANY_DEFAULTS = {
  name: 'VoIP Shop',
  address: '23 Lombardy Road, Broadacres, Johannesburg',
  phone: '+27 68 351 0074',
  email: 'sales@voipshop.co.za',
  vatRate: 0.15,
  validityDays: 7,
  // Public URL only used for EMAIL HTML (optional). PDF uses local file loader below.
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

// Prefer local logo; fallback to remote if provided (global fetch on Node 20)
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

// ---- PDF builder (refined layout; minutes in Unit; compact option) ----
async function buildQuotePdfBuffer(q, opts = {}) {
  const compact = !!opts.compact;

  const margin = compact ? 40 : 46;
  const doc = new PDFDocument({ size: 'A4', margin });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // Pre-calc left/right usable bounds
  const L = doc.page.margins.left;
  const R = doc.page.width - doc.page.margins.right;
  const W = R - L;

  // Load logo (local → remote)
  const logoBuf = await loadLogoBuffer(q.company.logoUrl);

  // Brand palette
  const brand = '#0071E3';
  const ink   = '#0f172a';
  const gray6 = '#475569';
  const gray4 = '#94a3b8';
  const line  = '#e5e7eb';
  const thbg  = '#f8fafc';
  const pill  = '#f1f5f9';

  // Top band (full-bleed OK)
  doc.save().rect(0, 0, doc.page.width, 6).fill(brand).restore();

  // Header — within [L, R]
  const headerTop = 22;
  if (logoBuf) {
    try { doc.image(logoBuf, L, headerTop, { width: compact ? 130 : 150 }); } catch {}
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
  const vat = Number(q.company.vatRate ?? 0.15);
  const onceSub = Number(q.subtotals.onceOff || 0);
  const monSub  = Number(q.subtotals.monthly || 0);
  const onceVat = onceSub * vat;
  const monVat  = monSub * vat;
  const onceTotal = onceSub + onceVat;
  const monTotal  = monSub + monVat;
  const grandPayNow = onceTotal + monTotal;

  // Totals cards
  const yStart = doc.y + (compact ? 10 : 14);

  function card(x, y, w, h, title, value, subtitle) {
    doc.save().roundedRect(x, y, w, h, 10).fill(pill).restore();
    doc.roundedRect(x, y, w, h, 10).strokeColor(line).stroke();

    doc.font('Helvetica').fontSize(9).fillColor(gray6).text(title, x + 12, y + 6);
    doc.font('Helvetica-Bold').fontSize(compact ? 12 : 13).fillColor(ink).text(value, x + 12, y + 18);
    if (subtitle) {
      doc.font('Helvetica').fontSize(9).fillColor(gray6)
        .text(subtitle, x + w - 70, y + 18, { width: 60, align: 'right' });
    }
  }

  const gap = 12;
  const cardH = compact ? 36 : 40;
  const cardW = (W - gap) / 2;
  card(L, yStart, cardW, cardH, 'MONTHLY', money(monTotal), '/month');
  card(L + cardW + gap, yStart, cardW, cardH, 'ONCE-OFF', money(onceTotal), 'setup');

  doc.y = yStart + cardH + (compact ? 12 : 16);

  // Helper: format Rand, or minutes label for call bundles in Monthly section
  function unitText(it, monthly) {
    const name = String(it.name || '');
    const looksLikeCalls = /call|minute/i.test(name);
    const minutes = it.minutes ?? it.includedMinutes;

    if (monthly && (minutes != null || looksLikeCalls)) {
      const m = Number(minutes) || 0;
      return m > 0 ? `${m} minutes` : 'Included minutes';
    }
    const unit = Number(it.unit ?? it.price ?? it.total ?? 0);
    return money(unit);
  }

  // Table helper
  function table(title, items, subtotalEx, vatAmt, totalInc, monthly = false) {
    const colW = [ W * 0.58, W * 0.12, W * 0.12, W * 0.18 ];
    const rowH = compact ? 20 : 24;
    const headH = compact ? 18 : 20;

    let y = doc.y;

    doc.font('Helvetica-Bold').fontSize(12).fillColor(ink).text(title, L, y, { width: W });
    y = doc.y + (compact ? 4 : 6);

    // header row
    doc.save().rect(L, y, W, headH).fill(thbg).restore();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(ink);
    doc.text('Description', L + 8, y + (compact ? 3 : 5), { width: colW[0] - 10 });
    doc.text('Qty',         L + colW[0], y + (compact ? 3 : 5), { width: colW[1], align: 'right' });
    doc.text('Unit',        L + colW[0] + colW[1], y + (compact ? 3 : 5), { width: colW[2], align: 'right' });
    doc.text('Amount',      L + colW[0] + colW[1] + colW[2], y + (compact ? 3 : 5), { width: colW[3], align: 'right' });

    doc.moveTo(L, y + headH).lineTo(R, y + headH).strokeColor(line).stroke();
    y += headH + 2;

    doc.font('Helvetica').fontSize(10).fillColor(ink);

    const zebra = ['#ffffff', '#fbfdff'];
    let rowIndex = 0;

    if (!items.length) {
      doc.text('No items.', L + 8, y, { width: W - 16 });
      y = doc.y + 6;
    } else {
      for (const it of items) {
        const qty    = Number(it.qty || 1);
        const unit   = Number(it.unit ?? it.price ?? it.total ?? 0);
        const amount = unit * qty;

        // zebra bg
        doc.save().rect(L, y, W, rowH).fill(zebra[rowIndex % 2]).restore();
        rowIndex++;

        doc.text(String(it.name || ''), L + 8, y + (compact ? 4 : 6), { width: colW[0] - 10 });
        doc.text(String(qty),           L + colW[0], y + (compact ? 4 : 6), { width: colW[1], align: 'right' });
        doc.text(unitText(it, monthly), L + colW[0] + colW[1], y + (compact ? 4 : 6), { width: colW[2], align: 'right' });
        doc.text(money(amount),         L + colW[0] + colW[1] + colW[2], y + (compact ? 4 : 6), { width: colW[3], align: 'right' });

        y += rowH;

        // page break safety
        if (y > doc.page.height - 160) {
          doc.addPage();
          y = doc.y;
        }
      }
    }

    // table totals
    doc.moveTo(L, y).lineTo(R, y).strokeColor(line).stroke();
    y += compact ? 8 : 10;

    const labelW = compact ? 130 : 140;
    const valW   = compact ? 100 : 110;
    const valX   = R - valW;
    const labelX = valX - labelW - 8;

    function totalLine(label, val, bold = false) {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(bold ? ink : gray6)
        .text(label, labelX, y, { width: labelW, align: 'right' });
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(ink)
        .text(money(val), valX, y, { width: valW, align: 'right' });
      y += compact ? 14 : 16;
    }

    totalLine('Subtotal', subtotalEx);
    totalLine(`VAT (${Math.round(vat * 100)}%)`, vatAmt);
    totalLine(monthly ? 'Total / month' : 'Total (once-off)', totalInc, true);

    doc.y = y + (compact ? 4 : 6);
  }

  // Sections
  table('Once-off Charges', q.itemsOnceOff, onceSub, onceVat, onceTotal, false);
  doc.moveDown(compact ? 0.6 : 0.8);
  table('Monthly Charges', q.itemsMonthly, monSub, monVat, monTotal, true);
  doc.moveDown(compact ? 1.0 : 1.2);

  // Grand total band — within [L, R]
  const yBand = doc.y + 4;
  const bandH = compact ? 28 : 32;

  doc.save().roundedRect(L, yBand, W, bandH, 8).fill(pill).restore();
  doc.roundedRect(L, yBand, W, bandH, 8).strokeColor(line).stroke();
  doc.font('Helvetica-Bold').fontSize(12).fillColor(ink)
    .text('Pay now (incl VAT)', L + 12, yBand + (compact ? 7 : 9));
  doc.text(money(grandPayNow), L, yBand + (compact ? 7 : 9), { width: W - 12, align: 'right' });

  doc.moveDown(compact ? 1.6 : 2.0);

  // Notes
  doc.font('Helvetica').fontSize(9).fillColor(gray6)
    .text('Included: Professional install & device setup; Remote support; PBX configuration; Number porting assistance. Standard call-out fee: R450.', L, undefined, { width: W });
  doc.moveDown(0.6);
  doc.text(`Notes: ${q.notes || ''}`, L, undefined, { width: W });
  doc.moveDown(0.6);
  doc.text(`This quote is valid for ${Number(q.validDays || 7)} days. Pricing in ZAR.`, L, undefined, { width: W });

  // Footer page numbers
  const addFooter = () => {
    const y = doc.page.height - 30;
    const x = L;
    const w = W;
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

// ---------------- API handler (auto-preview if no email, supports ?compact=1) ----------------
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Preview triggers:
  //  - explicit ?preview=1 (GET or POST)
  //  - any GET
  //  - POST without client.email (auto-preview)
  const explicitPreview =
    (req.query?.preview === '1' || req.query?.preview === 'true') ||
    (req.body?.preview === true || req.body?.preview === '1');

  // Compact flag
  const compact =
    (req.query?.compact === '1' || req.query?.compact === 'true') ||
    (req.body?.compact === true || req.body?.compact === '1');

  const body = req.method === 'POST' ? (req.body || {}) : {};
  const q = withDefaults(body);

  const noEmail = !q?.client?.email;
  const isPreview = explicitPreview || req.method === 'GET' || noEmail;

  try {
    const pdfBuffer = await buildQuotePdfBuffer(q, { compact });

    if (isPreview) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename=Quote-${q.quoteNumber}.pdf`);
      return res.status(200).send(pdfBuffer);
    }

    // ---- Normal email flow (POST + has client.email) ----
    const delivery =
      (body.delivery || '').toLowerCase() ||
      (process.env.USE_BLOB_LINK ? 'link' : 'attach');

    const from = 'sales@voipshop.co.za';
    const to = q.client.email;
    const subject = `VoIP Shop Quote • ${q.quoteNumber}`;
    const vat = Number(q.company.vatRate ?? 0.15);
    const monthlyInclVat = Number(q.subtotals.monthly || 0) * (1 + vat);

    if (delivery === 'link') {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        console.error('Missing BLOB_READ_WRITE_TOKEN for link delivery');
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
      if (error) {
        console.error('Resend send error (link):', error);
        return res.status(502).send('Email send failed: ' + (error?.message || 'unknown'));
      }

      return res.status(200).json({ ok: true, delivery: 'link', pdfUrl });
    } else {
      const { error, data } = await resend.emails.send({
        from, to, reply_to: from, subject,
        html: emailBodyTiny({ brand: q.company, clientName: q.client.name, monthlyInclVat }),
        attachments: [
          { filename: `Quote-${q.quoteNumber}.pdf`, content: pdfBuffer.toString('base64'), contentType: 'application/pdf' }
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
