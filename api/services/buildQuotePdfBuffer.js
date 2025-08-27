// services/buildQuotePdfBuffer.js
import PDFDocument from 'pdfkit';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ZAR money
const money = (n) =>
  'R ' + Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Prefer local logo; fallback to remote if provided
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

/**
 * Single-page QUOTE PDF (fits most cases by tightening spacing; if overflow, rows collapse into a "+N more…" line)
 */
export async function buildQuotePdfBuffer(q) {
  // Force compact to help 1-page fit
  const compact = true;

  // Page + margins (slightly tighter)
  const margin = 36;
  const doc = new PDFDocument({ size: 'A4', margin });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // Bounds
  const L = doc.page.margins.left;
  const R = doc.page.width - doc.page.margins.right;
  const W = R - L;

  // Brand palette — safe defaults
  const {
    brand = '#0B63E6',
    ink   = '#111111',
    gray6 = '#4b5563',
    gray4 = '#6b7280',
    line  = '#e5e7eb',
    thbg  = '#f5f5f7',
    pill  = '#f5f5f7'
  } = (q.company && q.company.colors) ? q.company.colors : {};

  const paintStamp = (text) => {
    if (!text) return;
    doc.save();
    doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font('Helvetica-Bold').fontSize(84).fillColor('#EEF2FF').opacity(0.7)
      .text(text, doc.page.width * 0.1, doc.page.height * 0.25, { width: doc.page.width * 0.8, align: 'center' });
    doc.opacity(1).restore();
  };

  // Top brand hairline
  doc.save().rect(0, 0, doc.page.width, 6).fill(brand).restore();

  // Header
  const headerTop = 18;
  const logoBuf = await loadLogoBuffer(q.company.logoUrl);
  if (logoBuf) {
    try { doc.image(logoBuf, L, headerTop, { width: 120 }); } catch {}
  } else {
    doc.font('Helvetica-Bold').fontSize(16).fillColor(ink).text(q.company.name, L, headerTop);
  }

  const datePretty = (() => {
    try { return new Date(q.dateISO).toISOString().slice(0, 10); } catch { return String(q.dateISO || '').slice(0, 10); }
  })();

  doc
    .font('Helvetica-Bold').fontSize(20).fillColor(ink)
    .text('Quote', L, headerTop, { width: W, align: 'right' })
    .moveDown(0.2);

  doc.font('Helvetica').fontSize(9.5).fillColor(gray6)
    .text(`Quote #: ${q.quoteNumber}`, L, undefined, { width: W, align: 'right' })
    .text(`Date: ${datePretty}`,       L, undefined, { width: W, align: 'right' })
    .text(`Valid: ${Number(q.validDays || 7)} days`, L, undefined, { width: W, align: 'right' });

  // Company block
  doc.moveDown(1.2);
  doc.font('Helvetica-Bold').fontSize(11.5).fillColor(ink).text(q.company.name, L, undefined, { width: W });
  doc.font('Helvetica').fontSize(9.5).fillColor(gray6)
    .text(q.company.address || '', L, undefined, { width: W })
    .text(`${q.company.phone || ''}${q.company.email ? ' • ' + q.company.email : ''}`, L, undefined, { width: W });

  // Client block
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(ink).text('Bill To', L, undefined, { width: W });
  doc.font('Helvetica').fontSize(9.5).fillColor(ink)
    .text(q.client?.name || '', L, undefined, { width: W })
    .text(q.client?.company || '', L, undefined, { width: W })
    .text(q.client?.email || '', L, undefined, { width: W })
    .text(q.client?.phone || '', L, undefined, { width: W })
    .text(q.client?.address || '', L, undefined, { width: W });

  // Totals (compute once)
  const vatRate = Number(q.company.vatRate ?? 0.15);
  const onceSub = Number(q.subtotals.onceOff || 0);
  const monSub  = Number(q.subtotals.monthly || 0);
  const onceVat = onceSub * vatRate;
  const monVat  = monSub * vatRate;
  const onceTotal = onceSub + onceVat;
  const monTotal  = monSub + monVat;
  const grandPayNow = onceTotal + monTotal;

  // Summary cards — tighter
  const yStart = doc.y + 12;
  const gap = 12;
  const cardH = 42;
  const cardW = (W - gap) / 2;

  const card = (x, y, w, h, title, valueTxt, subtitle) => {
    doc.save().roundedRect(x, y, w, h, 10).fill(pill).restore();
    doc.roundedRect(x, y, w, h, 10).strokeColor(line).stroke();
    doc.font('Helvetica').fontSize(8.8).fillColor(gray6).text(title, x + 10, y + 7);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(ink).text(valueTxt, x + 10, y + 22);
    if (subtitle) {
      doc.font('Helvetica').fontSize(8.5).fillColor(gray6)
        .text(subtitle, x + w - 64, y + 22, { width: 54, align: 'right' });
    }
  };
  card(L, yStart, cardW, cardH, 'MONTHLY', money(monTotal), '/month');
  card(L + cardW + gap, yStart, cardW, cardH, 'ONCE-OFF', money(onceTotal), 'hardware and setup');

  doc.y = yStart + cardH + 14;

  // ---- TABLE (with 1-page cap & minutes logic) ----
  const table = (title, items, subtotalEx, vatAmt, totalInc, monthly = false) => {
    const colW = [ W * 0.58, W * 0.12, W * 0.12, W * 0.18 ];
    const rowH = 18;
    const headH = 16;
    let y = doc.y;

    // Section title
    doc.font('Helvetica-Bold').fontSize(11.5).fillColor(ink).text(title, L, y, { width: W });
    y = doc.y + 4;

    // Header row
    doc.save().rect(L, y, W, headH).fill(thbg).restore();
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(ink);
    const headY = y + 3;
    doc.text('Description', L + 8, headY, { width: colW[0] - 10 });
    doc.text('Qty',         L + colW[0], headY, { width: colW[1], align: 'right' });
    doc.text('Unit',        L + colW[0] + colW[1], headY, { width: colW[2], align: 'right' });
    doc.text('Amount',      L + colW[0] + colW[1] + colW[2], headY, { width: colW[3], align: 'right' });

    doc.moveTo(L, y + headH).lineTo(R, y + headH).strokeColor(line).stroke();
    y += headH + 2;

    // 1-page cap helper: if not enough space, stop
    const ensureSpace = (need = 120) => {
      const bottom = doc.page.height - doc.page.margins.bottom;
      return y <= bottom - need;
    };

    // Body
    doc.font('Helvetica').fontSize(9.5).fillColor(ink);
    const zebra = ['#ffffff', '#fbfdff'];
    let rowIndex = 0;
    let hiddenCount = 0;

    if (!items.length) {
      if (ensureSpace(100)) {
        doc.text('No items.', L + 8, y, { width: W - 16 });
        y = doc.y + 6;
      }
    } else {
      for (let i = 0; i < items.length; i++) {
        // If not enough space for a row + totals footer, summarize and stop
        if (!ensureSpace(150)) {
          hiddenCount = items.length - i;
          break;
        }

        const it = items[i];
        const looksLikeCalls = /call|minute/i.test(String(it.name || ''));
        const minutes = Number(it.minutes || 0);

        const isMinutes = monthly && (minutes > 0 || looksLikeCalls);

        const qtyVal = isMinutes ? (minutes || 0) : Number(it.qty || 1);
        const unitDisplay = isMinutes ? 'minutes' : money(it.unit);

        // Amount rule: for minutes bundles, show the plan price (not price × minutes)
        const amount = isMinutes ? Number(it.unit || 0) : Number(it.unit || 0) * qtyVal;

        // Row bg
        doc.save().rect(L, y, W, rowH).fill(zebra[rowIndex % 2]).restore();
        rowIndex++;

        const rowTextY = y + 4;
        doc.text(String(it.name || ''), L + 8, rowTextY, { width: colW[0] - 10 });
        doc.text(String(qtyVal),         L + colW[0], rowTextY, { width: colW[1], align: 'right' });
        doc.text(unitDisplay,            L + colW[0] + colW[1], rowTextY, { width: colW[2], align: 'right' });
        doc.text(money(amount),          L + colW[0] + colW[1] + colW[2], rowTextY, { width: colW[3], align: 'right' });

        y += rowH;
      }
    }

    // If some rows couldn’t be shown, add a friendly summary line
    if (hiddenCount > 0 && ensureSpace(rowH + 60)) {
      doc.save().rect(L, y, W, rowH).fill(zebra[rowIndex % 2]).restore();
      doc.font('Helvetica-Oblique').fontSize(9).fillColor(gray6)
        .text(`+ ${hiddenCount} more item${hiddenCount > 1 ? 's' : ''} included in totals`,
              L + 8, y + 4, { width: W - 16 });
      y += rowH;
    }

    // Totals
    if (ensureSpace(64)) {
      doc.moveTo(L, y).lineTo(R, y).strokeColor(line).stroke();
      y += 8;

      const labelW = 128;
      const valW   = 108;
      const valX   = R - valW;
      const labelX = valX - labelW - 8;

      const totalLine = (label, val, bold = false) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.8).fillColor(bold ? ink : gray6)
          .text(label, labelX, y, { width: labelW, align: 'right' });
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(ink)
          .text(money(val), valX, y, { width: valW, align: 'right' });
        y += 14;
      };

      totalLine('Subtotal', subtotalEx);
      totalLine(`VAT (${Math.round(vatRate * 100)}%)`, vatAmt);
      totalLine(monthly ? 'Total / month' : 'Total (once-off)', totalInc, true);
    }

    doc.y = y + 4;
  };

  // Stamp (first page)
  paintStamp(q.stamp);

  // Sections
  table('Once-off Charges', q.itemsOnceOff, onceSub, onceVat, onceTotal, false);
  doc.moveDown(0.5);
  table('Monthly Charges', q.itemsMonthly, monSub, monVat, monTotal, true);
  doc.moveDown(0.8);

  // Pay-now band
  const yBand = doc.y + 2;
  const bandH = 28;
  doc.save().roundedRect(L, yBand, W, bandH, 10).fill(pill).restore();
  doc.roundedRect(L, yBand, W, bandH, 10).strokeColor(line).stroke();
  doc.font('Helvetica-Bold').fontSize(11.5).fillColor(ink)
    .text('Pay now (incl VAT)', L + 10, yBand + 7);
  doc.text(money(grandPayNow), L, yBand + 7, { width: W - 10, align: 'right' });

  doc.moveDown(1.0);

  // Notes — compacted
  const blurb = [
    'Included: Install & device setup • Remote support • PBX config • Porting assist. Std call-out: R450.',
    q.notes ? `Notes: ${q.notes}` : '',
    `Valid for ${Number(q.validDays || 7)} days. Pricing in ZAR.`
  ].filter(Boolean).join('\n');

  doc.font('Helvetica').fontSize(9).fillColor(gray6).text(blurb, L, undefined, { width: W });

  // Footer
  const addFooter = () => {
    const y = doc.page.height - 28;
    doc.font('Helvetica').fontSize(9).fillColor(gray4)
      .text(`${q.company.name} • ${q.company.email} • ${q.company.phone}`, L, y, { width: W, align: 'left' })
      .text(`Page ${doc.page.number}`, L, y, { width: W, align: 'right' });
  };
  addFooter();

  // IMPORTANT: never add a second page (keeps PDF to one page). No pageAdded handler.

  doc.end();
  return done;
}
