// services/buildQuotePdfBuffer.js
import PDFDocument from 'pdfkit';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ZAR money (kept)
const money = (n) =>
  'R ' + Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Prefer local logo; fallback to remote if provided (kept)
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
 * Build QUOTE PDF buffer (clean layout, summary cards, tables, pay-now band)
 * NOTE: this version caps the document at MAX 2 PAGES and slightly increases card spacing.
 */
export async function buildQuotePdfBuffer(q) {
  const compact = !!q.compact;

  // Page + margins (kept)
  const margin = compact ? 40 : 46;
  const doc = new PDFDocument({ size: 'A4', margin });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // Bounds (kept)
  const L = doc.page.margins.left;
  const R = doc.page.width - doc.page.margins.right;
  const W = R - L;

  // Brand palette — SAFER: defaults if colors missing
  const {
    brand = '#0B63E6',
    ink   = '#111111',
    gray6 = '#4b5563',
    gray4 = '#6b7280',
    line  = '#e5e7eb',
    thbg  = '#f5f5f7',
    pill  = '#f5f5f7'
  } = (q.company && q.company.colors) ? q.company.colors : {};

  // Optional watermark/stamp (kept)
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

  // Top brand hairline (kept)
  doc.save().rect(0, 0, doc.page.width, 6).fill(brand).restore();

  // Header (kept)
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

  // Company block (kept)
  doc.moveDown(compact ? 1.5 : 2);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(ink).text(q.company.name, L, undefined, { width: W });
  doc.font('Helvetica').fontSize(10).fillColor(gray6)
    .text(q.company.address || '', L, undefined, { width: W })
    .text(`${q.company.phone || ''}${q.company.email ? ' • ' + q.company.email : ''}`, L, undefined, { width: W });

  // Client block (kept)
  doc.moveDown(compact ? 1.0 : 1.2);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(ink).text('Bill To', L, undefined, { width: W });
  doc.font('Helvetica').fontSize(10).fillColor(ink)
    .text(q.client?.name || '', L, undefined, { width: W })
    .text(q.client?.company || '', L, undefined, { width: W })
    .text(q.client?.email || '', L, undefined, { width: W })
    .text(q.client?.phone || '', L, undefined, { width: W })
    .text(q.client?.address || '', L, undefined, { width: W });

  // Totals (compute once) (kept)
  const vatRate = Number(q.company.vatRate ?? 0.15);
  const onceSub = Number(q.subtotals.onceOff || 0);
  const monSub  = Number(q.subtotals.monthly || 0);
  const onceVat = onceSub * vatRate;
  const monVat  = monSub * vatRate;
  const onceTotal = onceSub + onceVat;
  const monTotal  = monSub + monVat;
  const grandPayNow = onceTotal + monTotal;

  // Summary cards — slightly more breathing room (minimal tweak)
  const yStart = doc.y + (compact ? 14 : 18);
  const gap = compact ? 14 : 16;
  const cardH = compact ? 48 : 52;
  const cardW = (W - gap) / 2;

  const card = (x, y, w, h, title, valueTxt, subtitle) => {
    doc.save().roundedRect(x, y, w, h, 12).fill(pill).restore();
    doc.roundedRect(x, y, w, h, 12).strokeColor(line).stroke();
    doc.font('Helvetica').fontSize(9).fillColor(gray6).text(title, x + 12, y + 8);
    doc.font('Helvetica-Bold').fontSize(compact ? 13 : 14).fillColor(ink).text(valueTxt, x + 12, y + 24);
    if (subtitle) {
      doc.font('Helvetica').fontSize(9).fillColor(gray6)
        .text(subtitle, x + w - 70, y + 24, { width: 60, align: 'right' });
    }
  };
  card(L, yStart, cardW, cardH, 'MONTHLY', money(monTotal), '/month');
  card(L + cardW + gap, yStart, cardW, cardH, 'ONCE-OFF', money(onceTotal), 'setup');

  doc.y = yStart + cardH + (compact ? 16 : 20);

  const unitText = (it, monthly) => {
    const looksLikeCalls = /call|minute/i.test(it.name);
    const minutes = it.minutes;
    if (monthly && (minutes != null || looksLikeCalls)) {
      const m = Number(minutes) || 0;
      return m > 0 ? `${m} minutes` : 'Included minutes';
    }
    return money(it.unit);
  };

  // Generic table renderer — MODIFIED: cap doc at 2 pages max
  const table = (title, items, subtotalEx, vatAmt, totalInc, monthly = false) => {
    const colW = [ W * 0.58, W * 0.12, W * 0.12, W * 0.18 ];
    const rowH = compact ? 20 : 24;
    const headH = compact ? 18 : 20;
    let y = doc.y;

    // Section title (kept)
    doc.font('Helvetica-Bold').fontSize(12).fillColor(ink).text(title, L, y, { width: W });
    y = doc.y + (compact ? 4 : 6);

    // Header row (kept)
    doc.save().rect(L, y, W, headH).fill(thbg).restore();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(ink);
    const headY = y + (compact ? 3 : 5);
    doc.text('Description', L + 8, headY, { width: colW[0] - 10 });
    doc.text('Qty',         L + colW[0], headY, { width: colW[1], align: 'right' });
    doc.text('Unit',        L + colW[0] + colW[1], headY, { width: colW[2], align: 'right' });
    doc.text('Amount',      L + colW[0] + colW[1] + colW[2], headY, { width: colW[3], align: 'right' });

    doc.moveTo(L, y + headH).lineTo(R, y + headH).strokeColor(line).stroke();
    y += headH + 2;

    // Body (with 2-page cap)
    doc.font('Helvetica').fontSize(10).fillColor(ink);
    const zebra = ['#ffffff', '#fbfdff'];
    let rowIndex = 0;

    const ensureSpace = (need = 140) => {
      const bottom = doc.page.height - doc.page.margins.bottom;
      if (y <= bottom - need) return true;
      // If already on page 2, STOP. (hard cap at 2 pages total)
      if (doc.page.number >= 2) return false;
      // else open page 2
      doc.addPage();
      paintStamp(q.stamp);
      // Optional: draw top brand hairline for second page too
      doc.save().rect(0, 0, doc.page.width, 6).fill(brand).restore();
      y = doc.y;
      return true;
    };

    if (!items.length) {
      if (ensureSpace(120)) {
        doc.text('No items.', L + 8, y, { width: W - 16 });
        y = doc.y + 6;
      }
    } else {
      let hiddenCount = 0;
      for (let i = 0; i < items.length; i++) {
        // need a full row; if we can’t, summarize and stop
        if (!ensureSpace(160)) {
          hiddenCount = items.length - i;
          break;
        }
        const it = items[i];
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

      // If some rows couldn’t be shown, add a friendly summary line (if there’s still room)
      if (hiddenCount > 0 && ensureSpace(rowH)) {
        doc.save().rect(L, y, W, rowH).fill(zebra[rowIndex % 2]).restore();
        doc.font('Helvetica-Oblique').fontSize(9).fillColor(gray6)
           .text(`+ ${hiddenCount} more item${hiddenCount > 1 ? 's' : ''} included in totals`,
                 L + 8, y + (compact ? 4 : 6), { width: W - 16 });
        y += rowH;
      }
    }

    // Totals (kept)
    if (ensureSpace((compact ? 8 : 10) + (compact ? 14 : 16) * 3)) {
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
    }

    doc.y = y + (compact ? 4 : 6);
  };

  // Paint optional page stamp first page (kept)
  paintStamp(q.stamp);

  // Sections (kept)
  table('Once-off Charges', q.itemsOnceOff, onceSub, onceVat, onceTotal, false);
  doc.moveDown(compact ? 0.6 : 0.8);
  table('Monthly Charges', q.itemsMonthly, monSub, monVat, monTotal, true);
  doc.moveDown(compact ? 1.0 : 1.2);

  // Pay-now band (kept)
  const yBand = doc.y + 4;
  const bandH = compact ? 30 : 34;
  doc.save().roundedRect(L, yBand, W, bandH, 10).fill(pill).restore();
  doc.roundedRect(L, yBand, W, bandH, 10).strokeColor(line).stroke();
  doc.font('Helvetica-Bold').fontSize(12).fillColor(ink)
    .text('Pay now (incl VAT)', L + 12, yBand + (compact ? 7 : 9));
  doc.text(money(grandPayNow), L, yBand + (compact ? 7 : 9), { width: W - 12, align: 'right' });

  doc.moveDown(compact ? 1.6 : 2.0);

  // Notes / Included (kept)
  const blurb = [
    'Included: Professional install & device setup; Remote support; PBX configuration; Number porting assistance. Standard call-out fee: R450.',
    q.notes ? `Notes: ${q.notes}` : '',
    `This quote is valid for ${Number(q.validDays || 7)} days. Pricing in ZAR.`
  ].filter(Boolean).join('\n');

  doc.font('Helvetica').fontSize(9).fillColor(gray6).text(blurb, L, undefined, { width: W });

  // Footer with page numbers + contact (kept)
  const addFooter = () => {
    const y = doc.page.height - 30;
    doc.font('Helvetica').fontSize(9).fillColor(gray4)
      .text(`${q.company.name} • ${q.company.email} • ${q.company.phone}`, L, y, { width: W, align: 'left' })
      .text(`Page ${doc.page.number}`, L, y, { width: W, align: 'right' });
  };
  addFooter();
  doc.on('pageAdded', () => {
    paintStamp(q.stamp);
    // draw the brand hairline on page 2 for continuity
    doc.save().rect(0, 0, doc.page.width, 6).fill(brand).restore();
    addFooter();
  });

  doc.end();
  return done;
}

