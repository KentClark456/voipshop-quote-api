// services/buildInvoicePdfBuffer.js
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
 * Single-page Invoice PDF:
 * - Tight, consistent spacing
 * - Hard one-page cap (no auto addPage)
 * - Minutes logic: Qty = minutes, Unit = "minutes", Amount = plan price
 */
export async function buildInvoicePdfBuffer(q) {
  // Always render compact to help 1-page fit
  const compact = true;

  // Page + margins
  const margin = 36;
  const doc = new PDFDocument({ size: 'A4', margin });

  // 🔒 HARD STOP: prevent any implicit/automatic extra pages
  const _realAddPage = doc.addPage.bind(doc);
  doc.addPage = function addPageNoop() { return this; }; // block all page additions

  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // Bounds
  const L = doc.page.margins.left;
  const R = doc.page.width - doc.page.margins.right;
  const W = R - L;
  const pageBottom = () => doc.page.height - doc.page.margins.bottom;

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

  // Watermark/stamp (optional)
  const paintStamp = (text) => {
    if (!text) return;
    doc.save();
    doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font('Helvetica-Bold').fontSize(84).fillColor('#EEF2FF').opacity(0.7)
      .text(text, doc.page.width * 0.1, doc.page.height * 0.25, {
        width: doc.page.width * 0.8,
        align: 'center'
      });
    doc.opacity(1).restore();
  };

  // Helper: ensure there is space left (reserve footer height)
  const FOOTER_H = 28;
  const ensureSpace = (need) => (doc.y <= pageBottom() - (need + FOOTER_H));

  // Top brand hairline
  doc.save().rect(0, 0, doc.page.width, 6).fill(brand).restore();

  // Header
  const headerTop = 18;
  const logoBuf = await loadLogoBuffer(q.company?.logoUrl);
  if (logoBuf) {
    try { doc.image(logoBuf, L, headerTop, { width: 120 }); } catch {}
  } else {
    doc.font('Helvetica-Bold').fontSize(16).fillColor(ink).text(q.company?.name || '', L, headerTop);
  }

  const datePretty = (() => {
    try { return new Date(q.dateISO).toISOString().slice(0, 10); }
    catch { return String(q.dateISO || '').slice(0, 10); }
  })();

  doc.font('Helvetica-Bold').fontSize(20).fillColor(ink)
    .text('Invoice', L, headerTop, { width: W, align: 'right' })
    .moveDown(0.2);

  doc.font('Helvetica').fontSize(9.5).fillColor(gray6)
    .text(`Invoice #: ${q.invoiceNumber || ''}`, L, undefined, { width: W, align: 'right' })
    .text(`Date: ${datePretty}`,            L, undefined, { width: W, align: 'right' })
    .text(`Valid: ${Number(q.validDays ?? 7)} days`, L, undefined, { width: W, align: 'right' });

  // Company block
  doc.moveDown(1.0);
  doc.font('Helvetica-Bold').fontSize(11.5).fillColor(ink)
    .text(q.company?.name || '', L, undefined, { width: W });
  doc.font('Helvetica').fontSize(9.5).fillColor(gray6)
    .text(q.company?.address || '', L, undefined, { width: W })
    .text(
      `${q.company?.phone || ''}${q.company?.email ? ' • ' + q.company.email : ''}`,
      L, undefined, { width: W }
    );

  // Client block
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(ink).text('Bill To', L, undefined, { width: W });
  doc.font('Helvetica').fontSize(9.5).fillColor(ink)
    .text(q.client?.name || '', L, undefined, { width: W })
    .text(q.client?.company || '', L, undefined, { width: W })
    .text(q.client?.email || '', L, undefined, { width: W })
    .text(q.client?.phone || '', L, undefined, { width: W })
    .text(q.client?.address || '', L, undefined, { width: W });

  // Totals (compute once)
  const vatRate = Number(q.company?.vatRate ?? 0.15);
  const onceSub = Number(q.subtotals?.onceOff || 0);
  const monSub  = Number(q.subtotals?.monthly || 0);
  const onceVat = onceSub * vatRate;
  const monVat  = monSub * vatRate;
  const onceTotal = onceSub + onceVat;
  const monTotal  = monSub + monVat;
  const grandPayNow = onceTotal + monTotal;

  // Summary cards
  const yStart = doc.y + 10;
  const gap = 12;
  const cardH = 42;
  const cardW = (W - gap) / 2;

  if (ensureSpace(cardH + 12)) {
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
    card(L + cardW + gap, yStart, cardW, cardH, 'ONCE-OFF', money(onceTotal), 'setup');
    doc.y = yStart + cardH + 12;
  }

  // Global minutes fallback (if the item itself doesn’t carry minutes)
  const globalMinutes =
    Number(
      (q?.minutes ??
       q?.monthlyControls?.minutes ??
       q?.meta?.minutes ??
       q?.meta?.minutesIncluded ??
       q?.controls?.minutes) || 0
    );

  // ---- TABLE (1-page, minutes-aware) ----
  const table = (title, items, subtotalEx, vatAmt, totalInc, monthly = false) => {
    const colW = [ W * 0.58, W * 0.12, W * 0.12, W * 0.18 ];
    const rowH = 18;
    const headH = 16;

    // Section title
    if (!ensureSpace(26)) return; // not enough space to render this section at all
    doc.font('Helvetica-Bold').fontSize(11.5).fillColor(ink).text(title, L, doc.y, { width: W });
    let y = doc.y + 4;

    // Header row
    if (!ensureSpace(headH + 2)) return;
    doc.save().rect(L, y, W, headH).fill(thbg).restore();
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(ink);
    const headY = y + 3;
    doc.text('Description', L + 8, headY, { width: colW[0] - 10 });
    doc.text('Qty',         L + colW[0], headY, { width: colW[1], align: 'right' });
    doc.text('Unit',        L + colW[0] + colW[1], headY, { width: colW[2], align: 'right' });
    doc.text('Amount',      L + colW[0] + colW[1] + colW[2], headY, { width: colW[3], align: 'right' });

    doc.moveTo(L, y + headH).lineTo(R, y + headH).strokeColor(line).stroke();
    y += headH + 2;

// --- inside function table(...) just after the header row drawing ---

// Body (robust minutes handling; safe defaults to avoid crashes)
doc.font('Helvetica').fontSize(9.5).fillColor(ink);
const zebra = ['#ffffff', '#fbfdff'];
let rowIndex = 0;
let hiddenCount = 0;

// Guard: global minutes may be undefined outside this closure
const safeGlobalMinutes = Number.isFinite(Number(globalMinutes)) ? Number(globalMinutes) : 0;

if (!Array.isArray(items) || items.length === 0) {
  if (ensureSpace(18)) {
    doc.text('No items.', L + 8, y, { width: W - 16 });
    y = doc.y + 4;
  }
} else {
  for (let i = 0; i < items.length; i++) {
    // Need room for a row + minimal totals later; if not, summarize and stop
    if (!ensureSpace(150)) { hiddenCount = items.length - i; break; }

    const it = items[i] || {};
    const name = typeof it.name === 'string' ? it.name : String(it.name ?? '');

    // Type-safe number coercions
    const unitRaw = Number(it.unit);
    const qtyRaw  = Number(it.qty);

    // Minutes detection (very forgiving but safe)
    const looksLikeCalls = /(?:^|\b)(?:calls?|minutes?|bundle)\b/i.test(name);

    // ⬇️ NEW: include a couple more common aliases + a fallback that parses minutes from the name
    const minuteCandidates = [
      it.minutes,
      it.qtyMinutes,
      it.minutesIncluded,
      it.includedMinutes,
      it.qty_min,
      it.qty_mins,
      it.qtyMin,        // NEW alias
      it.qtyMins        // NEW alias
    ];

    let itemMinutes = minuteCandidates
      .map(n => Number(n))
      .find(n => Number.isFinite(n) && n > 0) || 0;

    // ⬇️ NEW: name-based fallback e.g. "Call Bundle 500", "500 minutes", "x500"
    if (!itemMinutes) {
      const m = name.match(/(\d{2,5})\s*(?:mins?|minutes?)\b/i)    // "500 minutes"
             || name.match(/\bbundle\s*(\d{2,5})\b/i)             // "Bundle 500"
             || name.match(/\bx\s*(\d{2,5})\b/i);                 // "x500"
      if (m && Number(m[1]) > 0) itemMinutes = Number(m[1]);
    }

    // Final minutes for this row
    const minutesForRow = itemMinutes > 0 ? itemMinutes : (looksLikeCalls ? safeGlobalMinutes : 0);

    // Only treat as minutes bundle on Monthly table
    const isMinutesBundle = !!(monthly && minutesForRow > 0);

    // Quantities & unit display
    const qtyVal = isMinutesBundle
      ? minutesForRow
      : (Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1);

    const unitDisplay = isMinutesBundle
      ? 'minutes'
      : money(Number.isFinite(unitRaw) ? unitRaw : 0);

    // Amount:
    // If you price minutes by bundle, we convert minutes to bundles using bundleSize (default 250);
    // Otherwise (no bundle concept), we just do unit * qty like normal items.
    let amount = 0;
    if (isMinutesBundle) {
      const bundleSize = Number(it.bundleSize || q?.meta?.bundleSize || 250); // slight enhancement: allow q.meta.bundleSize
      const bundles = (Number.isFinite(bundleSize) && bundleSize > 0)
        ? (minutesForRow / bundleSize)
        : 0;
      amount = (Number.isFinite(unitRaw) ? unitRaw : 0) * bundles;
    } else {
      amount = (Number.isFinite(unitRaw) ? unitRaw : 0) * qtyVal;
    }
    if (!Number.isFinite(amount)) amount = 0;

    // Row bg
    doc.save().rect(L, y, W, rowH).fill(zebra[rowIndex % 2]).restore();
    rowIndex++;

    const rowTextY = y + 4;
    doc.text(name,                 L + 8,                        rowTextY, { width: colW[0] - 10 });
    doc.text(String(qtyVal || 0),  L + colW[0],                  rowTextY, { width: colW[1], align: 'right' });
    doc.text(unitDisplay,          L + colW[0] + colW[1],        rowTextY, { width: colW[2], align: 'right' });
    doc.text(money(amount),        L + colW[0] + colW[1] + colW[2], rowTextY, { width: colW[3], align: 'right' });

    y += rowH;
  }
}

    // Hidden rows notice
    if (hiddenCount > 0 && ensureSpace(rowH + 56)) {
      doc.save().rect(L, y, W, rowH).fill(zebra[rowIndex % 2]).restore();
      doc.font('Helvetica-Oblique').fontSize(9).fillColor(gray6)
        .text(`+ ${hiddenCount} more item${hiddenCount > 1 ? 's' : ''} included in totals`,
              L + 8, y + 4, { width: W - 16 });
      y += rowH;
    }

    // Totals
    if (ensureSpace(58)) {
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

  // Stamp (first page only)
  paintStamp(q.stamp);

  // Sections
  table('Once-off Charges', q.itemsOnceOff || [], onceSub, onceVat, onceTotal, false);
  doc.moveDown(0.4);
  table('Monthly Charges', q.itemsMonthly || [], monSub, monVat, monTotal, true);

  // Pay-now band
  if (ensureSpace(40)) {
    const yBand = doc.y + 2;
    const bandH = 28;
    doc.save().roundedRect(L, yBand, W, bandH, 10).fill(pill).restore();
    doc.roundedRect(L, yBand, W, bandH, 10).strokeColor(line).stroke();
    doc.font('Helvetica-Bold').fontSize(11.5).fillColor(ink)
      .text('Pay now (incl VAT)', L + 10, yBand + 7);
    doc.text(money(grandPayNow), L, yBand + 7, { width: W - 10, align: 'right' });
    doc.y = yBand + bandH + 6;
  }

  // Notes (render only if they fit cleanly)
  const notes = [
    'Included: Install & device setup • Remote support • PBX config • Porting assist. Std call-out: R450.',
    q.notes ? `Notes: ${q.notes}` : '',
    `Valid for ${Number(q.validDays ?? 7)} days. Pricing in ZAR.`
  ].filter(Boolean).join('\n');

  const notesH = doc.heightOfString(notes, { width: W, align: 'left' });
  if (ensureSpace(notesH + 6)) {
    doc.font('Helvetica').fontSize(9).fillColor(gray6).text(notes, L, doc.y, { width: W });
  }

  // Footer
  const yFooter = doc.page.height - FOOTER_H + 2;
  doc.font('Helvetica').fontSize(9).fillColor(gray4)
    .text(`${q.company?.name || ''} • ${q.company?.email || ''} • ${q.company?.phone || ''}`, L, yFooter, { width: W, align: 'left' })
    .text(`Page ${doc.page.number}`, L, yFooter, { width: W, align: 'right' });

  doc.end();
  return done;
}
