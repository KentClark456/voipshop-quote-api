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
 * Single-page QUOTE PDF (compact; minutes-aware)
 */
export async function buildQuotePdfBuffer(q = {}) {
  const margin = 36;
  const doc = new PDFDocument({ size: 'A4', margin });

  // Hard cap to one page
  const _realAddPage = doc.addPage.bind(doc);
  doc.addPage = function noop() { return this; };

  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // Bounds
  const L = doc.page.margins.left;
  const R = doc.page.width - doc.page.margins.right;
  const W = R - L;
  const pageBottom = () => doc.page.height - doc.page.margins.bottom;

  // Palette
  const colors = (q.company && q.company.colors) ? q.company.colors : {};
  const brand = colors.brand ?? '#0B63E6';
  const ink   = colors.ink   ?? '#111111';
  const gray6 = colors.gray6 ?? '#4b5563';
  const gray4 = colors.gray4 ?? '#6b7280';
  const line  = colors.line  ?? '#e5e7eb';
  const thbg  = colors.thbg  ?? '#f5f5f7';
  const pill  = colors.pill  ?? '#f5f5f7';

  // Helper: can we fit 'need' pixels above footer? (supports local y)
  const FOOTER_H = 28;
  const ensureSpace = (need, yPos = doc.y) => (yPos <= pageBottom() - (need + FOOTER_H));

  // Optional watermark
  const paintStamp = (text) => {
    if (!text) return;
    doc.save();
    doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font('Helvetica-Bold').fontSize(84).fillColor('#EEF2FF').opacity(0.7)
      .text(text, doc.page.width * 0.1, doc.page.height * 0.25, {
        width: doc.page.width * 0.8, align: 'center'
      });
    doc.opacity(1).restore();
  };

  // Top brand hairline
  doc.save().rect(0, 0, doc.page.width, 6).fill(brand).restore();

  // Header
  const headerTop = 18;
  const logoBuf = await loadLogoBuffer(q.company?.logoUrl);
  if (logoBuf) {
    try { doc.image(logoBuf, L, headerTop, { width: 120 }); } catch {}
  } else if (q.company?.name) {
    doc.font('Helvetica-Bold').fontSize(16).fillColor(ink).text(q.company.name, L, headerTop);
  }

  const datePretty = (() => {
    try { return new Date(q.dateISO).toISOString().slice(0, 10); }
    catch { return String(q.dateISO || '').slice(0, 10); }
  })();

  doc.font('Helvetica-Bold').fontSize(20).fillColor(ink)
     .text('Quote', L, headerTop, { width: W, align: 'right' })
     .moveDown(0.2);

  doc.font('Helvetica').fontSize(9.5).fillColor(gray6)
     .text(`Quote #: ${q.quoteNumber || ''}`, L, undefined, { width: W, align: 'right' })
     .text(`Date: ${datePretty}`,            L, undefined, { width: W, align: 'right' })
     .text(`Valid: ${Number(q.validDays ?? 7)} days`, L, undefined, { width: W, align: 'right' });

  // Company block
  doc.moveDown(1.0);
  if (q.company?.name) {
    doc.font('Helvetica-Bold').fontSize(11.5).fillColor(ink).text(q.company.name, L, undefined, { width: W });
  }
  doc.font('Helvetica').fontSize(9.5).fillColor(gray6)
     .text(q.company?.address || '', L, undefined, { width: W })
     .text(`${q.company?.phone || ''}${q.company?.email ? ' • ' + q.company.email : ''}`,
           L, undefined, { width: W });

  // Client block
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(ink).text('Bill To', L, undefined, { width: W });
  doc.font('Helvetica').fontSize(9.5).fillColor(ink)
     .text(q.client?.name || '', L, undefined, { width: W })
     .text(q.client?.company || '', L, undefined, { width: W })
     .text(q.client?.email || '', L, undefined, { width: W })
     .text(q.client?.phone || '', L, undefined, { width: W })
     .text(q.client?.address || '', L, undefined, { width: W });

// ---- WHY CHOOSE US (benefits first)
if (ensureSpace(90)) {
  const cardYStart = doc.y + 10;   // where the card begins
  const pad = 10;

  // Title
  doc.font('Helvetica-Bold').fontSize(11).fillColor(ink)
     .text('Why choose VoIP Shop', L + pad, cardYStart + 8, { width: W - pad * 2 });

  // Bullets helper
  const bullet = (t) => {
    const x = L + pad + 10;               // text start
    const cy = doc.y + 4;                 // circle center (baseline-ish)
    // dot
    doc.save()
       .circle(L + pad + 2.5, cy, 1.4)
       .fill(gray6)
       .restore();
    // text
    doc.fillColor(ink).font('Helvetica').fontSize(9.5)
       .text(t, x, doc.y, { width: W - pad * 2 - 12, lineGap: 1 });
    // small spacer between bullets
    doc.y += 4;
  };

  // Move below the title line before bullets
  doc.y = cardYStart + 28;

  // Bullets (no background fill; we’ll draw the border afterwards)
  bullet('Buy direct—no sales commissions baked into hardware pricing.');
  bullet('Own your equipment outright; insure it with your provider at the correct replacement value.');
  bullet('Avoid finance charges by purchasing equipment upfront through VoIP Shop.');
  bullet('Get help from a support-led team focused on uptime, not sales targets.');

  // Compute final card height based on content drawn
  const contentBottom = doc.y + 6;
  const cardHeight = Math.max(60, contentBottom - cardYStart);

  // Draw ONLY a stroked frame around everything (title + 4 bullets)
  doc.save()
     .roundedRect(L, cardYStart, W, cardHeight, 10)
     .strokeColor(line)
     .lineWidth(1)
     .stroke()
     .restore();

  // Advance cursor below card
  doc.y = cardYStart + cardHeight + 10;
}

  // Totals (compute once)
  const vatRate = Number(q.company?.vatRate ?? 0.15);
  const onceSub = Number(q.subtotals?.onceOff || 0);
  const monSub  = Number(q.subtotals?.monthly || 0);
  const onceVat = onceSub * vatRate;
  const monVat  = monSub * vatRate;
  const onceTotal = onceSub + onceVat;
  const monTotal  = monSub + monVat;

  // Summary cards (Monthly / Once-off) — clear & no "Pay now"
  {
    const yStart = doc.y + 6;
    const gap = 10;
    const cardH = 40;
    const cardW = (W - gap) / 2;
    if (ensureSpace(cardH + 12, yStart)) {
      const card = (x, y, w, h, title, valueTxt, subtitle) => {
        doc.save().roundedRect(x, y, w, h, 10).fill(pill).restore();
        doc.roundedRect(x, y, w, h, 10).strokeColor(line).stroke();
        doc.font('Helvetica').fontSize(8.6).fillColor(gray6).text(title, x + 10, y + 6);
        doc.font('Helvetica-Bold').fontSize(12.5).fillColor(ink).text(valueTxt, x + 10, y + 21);
        if (subtitle) {
          doc.font('Helvetica').fontSize(8.4).fillColor(gray6)
             .text(subtitle, x + w - 62, y + 21, { width: 52, align: 'right' });
        }
      };
      card(L, yStart, cardW, cardH, 'MONTHLY (incl VAT)', money(monTotal), '/month');
      card(L + cardW + gap, yStart, cardW, cardH, 'ONCE-OFF (incl VAT)', money(onceTotal), 'setup');
      doc.y = yStart + cardH + 10;
    }
  }

  // Global minutes fallback
  const globalMinutes = Number(
    q?.minutes ??
    q?.monthlyControls?.minutes ??
    q?.meta?.minutes ??
    q?.meta?.minutesIncluded ??
    q?.controls?.minutes ??
    0
  );

  // ---- TABLE (one page; compact; minutes-aware)
  const table = (title, items, subtotalEx, vatAmt, totalInc, monthly = false) => {
    const colW  = [ W * 0.58, W * 0.12, W * 0.12, W * 0.18 ];
    const headH = 14;
    const rowH  = 16;  // slimmer rows

    // Section title
    if (!ensureSpace(24)) return;
    const titleY = doc.y;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(ink).text(title, L, titleY, { width: W });
    // >>> FIX: sync local y with doc.y to avoid overlap, and add breathing room
    let y = doc.y + 4;

    // Header row
    if (!ensureSpace(headH + 2, y)) { doc.y = y; return; }
    doc.save().rect(L, y, W, headH).fill(thbg).restore();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(ink);
    const headY = y + 2;
    doc.text('Description', L + 8, headY, { width: colW[0] - 10 });
    doc.text('Qty',         L + colW[0], headY, { width: colW[1], align: 'right' });
    doc.text('Unit',        L + colW[0] + colW[1], headY, { width: colW[2], align: 'right' });
    doc.text('Amount',      L + colW[0] + colW[1] + colW[2], headY, { width: colW[3], align: 'right' });
    doc.moveTo(L, y + headH).lineTo(R, y + headH).strokeColor(line).stroke();
    y += headH + 1;

    // Body
    doc.font('Helvetica').fontSize(9).fillColor(ink);
    const zebra = ['#ffffff', '#fbfdff'];
    let rowIndex = 0;
    let hiddenCount = 0;

    const safeGlobalMinutes = Number.isFinite(Number(globalMinutes)) ? Number(globalMinutes) : 0;
    const itemsArr = Array.isArray(items) ? items : [];

    for (let i = 0; i < itemsArr.length; i++) {
      // Need room for at least a row + totals
      if (!ensureSpace(120, y)) { hiddenCount = itemsArr.length - i; break; }

      const it   = itemsArr[i] || {};
      const name = typeof it.name === 'string' ? it.name : String(it.name ?? '');
      const nameLower = name.toLowerCase();

      const unitRaw = Number(it.unit);
      const qtyRaw  = Number(it.qty);

      // Detect calls/minutes line
      const looksLikeCalls =
        Boolean(it.isCalls) ||
        /(?:^|\b)(?:calls?|minutes?|bundle)\b/i.test(name);

      // Pull minutes from tags first
      const minuteCandidates = [
        it.minutes, it.qtyMinutes, it.minutesIncluded, it.includedMinutes,
        it.qty_min, it.qty_mins, it.qtyMin, it.qtyMins, it.bundleMinutes
      ];
      let itemMinutes =
        minuteCandidates.map(n => Number(n)).find(n => Number.isFinite(n) && n > 0) || 0;

      // If still not present, try parsing from the name
      if (!itemMinutes) {
        const m = name.match(/(\d{2,5})\s*(?:mins?|minutes?)\b/i)
               || name.match(/\bbundle\s*(\d{2,5})\b/i)
               || name.match(/\bx\s*(\d{2,5})\b/i);
        if (m && Number(m[1]) > 0) itemMinutes = Number(m[1]);
      }

      // Final minutes value per row
      const minutesForRow = itemMinutes > 0 ? itemMinutes : (looksLikeCalls ? safeGlobalMinutes : 0);

      // Explicit Pay-as-you-go detection → force 0 minutes
      const isPayg = looksLikeCalls && (
        /pay[-\s]?as[-\s]?you[-\s]?go/i.test(nameLower) ||
        Number(minutesForRow) <= 0 ||
        Number(qtyRaw) <= 0
      );

      // For calls with minutes, show minutes as the Qty and "minutes" as Unit
      const isMinutesBundle = !!(monthly && looksLikeCalls && !isPayg && minutesForRow > 0);

      // Compute Qty/Unit/Amount
      const qtyVal = isMinutesBundle
        ? minutesForRow            // show actual minutes
        : isPayg
          ? 0                      // PAYG shows 0 minutes
          : (Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1);

      const unitDisplay = (isMinutesBundle || isPayg)
        ? 'minutes'
        : money(Number.isFinite(unitRaw) ? unitRaw : 0);

      // Use bundle calc for minutes-based calls, else qty * unit
      const bundleSize = Number(it.bundleSize || q?.meta?.bundleSize || 250);
      const unitForCalc = looksLikeCalls
        ? (Number.isFinite(unitRaw) && unitRaw > 0 ? unitRaw : 100) // default R100/bundle if missing
        : (Number.isFinite(unitRaw) ? unitRaw : 0);

      let amount = 0;
      if (isMinutesBundle) {
        const bundles = (Number.isFinite(bundleSize) && bundleSize > 0) ? (minutesForRow / bundleSize) : 0;
        amount = unitForCalc * bundles;
      } else if (isPayg) {
        amount = 0; // Pay-as-you-go -> 0 minutes -> R0
      } else {
        amount = unitForCalc * qtyVal;
      }
      if (!Number.isFinite(amount)) amount = 0;

      // Row bg
      doc.save().rect(L, y, W, rowH).fill(zebra[rowIndex % 2]).restore();
      rowIndex++;

      // Description: append minutes context for calls
      const desc = looksLikeCalls
        ? (isPayg
            ? `${name} — 0 minutes (Pay-as-you-go)`
            : `${name} — ${minutesForRow} minutes`)
        : name;

      const rowTextY = y + 3;
      doc.text(desc,                L + 8,                       rowTextY, { width: colW[0] - 10 });
      doc.text(String(qtyVal || 0), L + colW[0],                 rowTextY, { width: colW[1], align: 'right' });
      doc.text(unitDisplay,         L + colW[0] + colW[1],       rowTextY, { width: colW[2], align: 'right' });
      doc.text(money(amount),       L + colW[0] + colW[1] + colW[2], rowTextY, { width: colW[3], align: 'right' });

      y += rowH;
    }

    // Hidden rows notice
    if (hiddenCount > 0 && ensureSpace(rowH + 40, y)) {
      doc.save().rect(L, y, W, rowH).fill(zebra[rowIndex % 2]).restore();
      doc.font('Helvetica-Oblique').fontSize(9).fillColor(gray6)
         .text(`+ ${hiddenCount} more item${hiddenCount > 1 ? 's' : ''} included in totals`,
               L + 8, y + 3, { width: W - 16 });
      y += rowH;
    }

    // Totals
    if (ensureSpace(52, y)) {
      doc.moveTo(L, y).lineTo(R, y).strokeColor(line).stroke();
      y += 6;

      const labelW = 124;
      const valW   = 104;
      const valX   = R - valW;
      const labelX = valX - labelW - 8;

      const totalLine = (label, val, bold = false) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.4).fillColor(bold ? ink : gray6)
           .text(label, labelX, y, { width: labelW, align: 'right' });
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(ink)
           .text(money(val), valX, y, { width: valW, align: 'right' });
        y += 12;
      };

      totalLine('Subtotal', subtotalEx);
      totalLine(`VAT (${Math.round(vatRate * 100)}%)`, vatAmt);
      totalLine(monthly ? 'Total / month' : 'Total (once-off)', totalInc, true);
    }

    // Commit local y
    doc.y = y + 2;
  };

  // Stamp (first page only)
  paintStamp(q.stamp);

  // Sections (note the spacing fix is inside table())
  table('Once-off Charges', q.itemsOnceOff || [], onceSub, onceVat, onceTotal, false);
  doc.moveDown(0.6);
  table('Monthly Charges',  q.itemsMonthly || [], monSub,  monVat,  monTotal,  true);

  // Notes (if they fit)
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
