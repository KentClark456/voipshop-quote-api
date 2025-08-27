// services/buildInvoicePdfBuffer.js
import PDFDocument from 'pdfkit';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Money (ZAR)
const money = (n) =>
  'R ' + Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Prefer local logo; fallback to remote if provided
async function loadLogoBuffer(overrideUrl = '') {
  const localCandidates = [
    path.resolve(__dirname, '../Assets/Group 1642logo (1).png'),
    path.resolve(__dirname, '../../Assets/Group 1642logo (1).png'),
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

// Colors with safe defaults (aligns with quote)
function resolveColors(colorsIn = {}) {
  const c = colorsIn || {};
  const defaults = {
    brand: '#0ea5e9', // accent
    ink:   '#111827', // text
    gray6: '#6b7280', // muted text
    gray4: '#9ca3af', // light text
    line:  '#e5e7eb', // borders
    thbg:  '#f3f4f6', // table header bg
    pill:  '#f9fafb', // card bg
  };
  return {
    brand: c.brand ?? c.primary ?? defaults.brand,
    ink:   c.ink   ?? c.text    ?? defaults.ink,
    gray6: c.gray6 ?? c.muted   ?? c.secondary ?? defaults.gray6,
    gray4: c.gray4 ?? defaults.gray4,
    line:  c.line  ?? c.border  ?? defaults.line,
    thbg:  c.thbg  ?? c.header  ?? defaults.thbg,
    pill:  c.pill  ?? c.panel   ?? defaults.pill,
  };
}

/**
 * Build INVOICE PDF buffer — single page, compact layout.
 * Visually aligned with Quote, but title = "Invoice".
 */
export async function buildInvoicePdfBuffer(inv = {}) {
  // --- Document (hard cap to one page) ---
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const _realAddPage = doc.addPage.bind(doc);
  doc.addPage = function noopAddPage() { return this; }; // block page additions

  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const L = doc.page.margins.left;
  const R = doc.page.width - doc.page.margins.right;
  const W = R - L;
  const pageBottom = () => doc.page.height - doc.page.margins.bottom;

  const { brand, ink, gray6, gray4, line, thbg, pill } = resolveColors(inv?.company?.colors);

  const FOOTER_H = 28;
  let y = doc.y;

  const ensureSpace = (need) => (y <= (pageBottom() - (need + FOOTER_H)));
  const moveY = (amt=0) => { y = (doc.y = doc.y + amt); };

  // Optional big watermark (e.g., PAID)
  const paintStamp = (text) => {
    if (!text) return;
    doc.save();
    doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font('Helvetica-Bold').fontSize(88).fillColor('#EEF2FF').opacity(0.7)
       .text(text, doc.page.width * 0.1, doc.page.height * 0.25, {
         width: doc.page.width * 0.8, align: 'center'
       });
    doc.opacity(1).restore();
  };

  // Top brand hairline
  doc.save().rect(0, 0, doc.page.width, 6).fill(brand).restore();

  // Header (logo + right title/meta)
  const headerTop = 22;
  const logoBuf = await loadLogoBuffer(inv?.company?.logoUrl);
  if (logoBuf) {
    try { doc.image(logoBuf, L, headerTop, { width: 130 }); } catch {}
  } else {
    doc.font('Helvetica-Bold').fontSize(16).fillColor(ink).text(inv?.company?.name || 'Company', L, headerTop);
  }

  const datePretty = (() => {
    try { return new Date(inv?.dateISO).toISOString().slice(0, 10); }
    catch { return String(inv?.dateISO || '').slice(0, 10); }
  })();

  doc.font('Helvetica-Bold').fontSize(20).fillColor(ink)
     .text('Invoice', L, headerTop, { width: W, align: 'right' }).moveDown(0.2);

  doc.font('Helvetica').fontSize(10).fillColor(gray6)
     .text(`Invoice #: ${inv?.invoiceNumber ?? ''}`, L, undefined, { width: W, align: 'right' })
     .text(`Order #: ${inv?.orderNumber ?? ''}`,    L, undefined, { width: W, align: 'right' })
     .text(`Date: ${datePretty}`,                   L, undefined, { width: W, align: 'right' })
     .text(`Due: ${Number(inv?.dueDays ?? 7)} days`,L, undefined, { width: W, align: 'right' });

  // Company info (left column)
  doc.moveDown(1.6);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(ink).text(inv?.company?.name || 'Company', L, undefined, { width: W });
  doc.font('Helvetica').fontSize(10).fillColor(gray6)
     .text(inv?.company?.address || '', L, undefined, { width: W })
     .text(`${inv?.company?.phone || ''}${inv?.company?.email ? ' • ' + inv.company.email : ''}`, L, undefined, { width: W });

  // Bill To
  doc.moveDown(0.9);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(ink).text('Bill To', L, undefined, { width: W });
  doc.font('Helvetica').fontSize(10).fillColor(ink)
     .text(inv?.client?.name || '', L, undefined, { width: W })
     .text(inv?.client?.company || '', L, undefined, { width: W })
     .text(inv?.client?.email || '', L, undefined, { width: W })
     .text(inv?.client?.phone || '', L, undefined, { width: W })
     .text(inv?.client?.address || '', L, undefined, { width: W });

  // Totals math
  const vatRate = Number(inv?.company?.vatRate ?? 0.15);
  const onceSub = Number(inv?.subtotals?.onceOff || 0);
  const monSub  = Number(inv?.subtotals?.monthly || 0);
  const onceVat = onceSub * vatRate;
  const monVat  = monSub * vatRate;
  const onceTotal = onceSub + onceVat;
  const monTotal  = monSub + monVat;
  const grandPayNow = onceTotal + monTotal;

  // Summary cards (MONTHLY / ONCE-OFF)
  const yStart = doc.y + 10;
  const gap = 12;
  const cardH = 44;
  const cardW = (W - gap) / 2;
  const card = (x, y0, w, h, title, value, subtitle) => {
    doc.save().roundedRect(x, y0, w, h, 12).fill(pill).restore();
    doc.roundedRect(x, y0, w, h, 12).strokeColor(line).stroke();
    doc.font('Helvetica').fontSize(9).fillColor(gray6).text(title, x + 12, y0 + 8);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(ink).text(value, x + 12, y0 + 22);
    if (subtitle) {
      doc.font('Helvetica').fontSize(9).fillColor(gray6)
         .text(subtitle, x + w - 70, y0 + 22, { width: 60, align: 'right' });
    }
  };
  card(L, yStart, cardW, cardH, 'MONTHLY',  money(monTotal),  '/month');
  card(L + cardW + gap, yStart, cardW, cardH, 'ONCE-OFF', money(onceTotal), 'setup');
  doc.y = yStart + cardH + 12; y = doc.y;

  // Unit text logic (minutes on monthly lines)
  const unitText = (it, monthly) => {
    const looksLikeCalls = /call|minute/i.test(it?.name || '');
    const minutes = it?.minutes;
    if (monthly && (minutes != null || looksLikeCalls)) {
      const m = Number(minutes) || 0;
      return m > 0 ? `${m} minutes` : 'Included minutes';
    }
    return money(it?.unit || 0);
  };

  // Single-page table renderer (no addPage; clamp rows; show hidden count)
  const table = (title, items = [], subtotalEx, vatAmt, totalInc, monthly = false) => {
    const headH = 18;
    const rowH  = 20;
    const bottomReserve = 150; // space we need after table for totals band + notes + footer

    const colW = [ W * 0.58, W * 0.12, W * 0.12, W * 0.18 ];
    const x = L;
    let hiddenCount = 0;

    // Title
    if (!ensureSpace(headH + 40)) return; // not enough room to render this section
    doc.font('Helvetica-Bold').fontSize(12).fillColor(ink).text(title, x, y, { width: W });
    moveY(4);

    // Header
    doc.save().rect(x, y, W, headH).fill(thbg).restore();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(ink);
    const headY = y + 3;
    doc.text('Description', x + 8, headY, { width: colW[0] - 10 });
    doc.text('Qty',         x + colW[0], headY, { width: colW[1], align: 'right' });
    doc.text('Unit',        x + colW[0] + colW[1], headY, { width: colW[2], align: 'right' });
    doc.text('Amount',      x + colW[0] + colW[1] + colW[2], headY, { width: colW[3], align: 'right' });
    doc.moveTo(x, y + headH).lineTo(R, y + headH).strokeColor(line).stroke();
    moveY(headH + 2);

    // Rows
    doc.font('Helvetica').fontSize(10).fillColor(ink);
    const zebra = ['#ffffff', '#fbfdff'];
    let rowIndex = 0;
    let subtotalSeen = 0;

    const maxRowsThatFit = () => {
      // how many rows can fit until we reach pageBottom - bottomReserve?
      const room = (pageBottom() - FOOTER_H - bottomReserve) - y;
      return Math.max(0, Math.floor(room / rowH));
    };

    const itemsArr = Array.isArray(items) ? items : [];
    let maxRows = maxRowsThatFit();

    for (let i = 0; i < itemsArr.length; i++) {
      if (maxRows <= 0) { hiddenCount = itemsArr.length - i; break; }

      const it = itemsArr[i];
      const qty    = Number(it?.qty || 1);
      const amount = (Number(it?.unit || 0)) * qty;

      // Row bg
      doc.save().rect(x, y, W, rowH).fill(zebra[rowIndex % 2]).restore();
      rowIndex++;

      const rowTextY = y + 4;
      doc.text(String(it?.name || ''), x + 8, rowTextY, { width: colW[0] - 10 });
      doc.text(String(qty),            x + colW[0], rowTextY, { width: colW[1], align: 'right' });
      doc.text(unitText(it, monthly),  x + colW[0] + colW[1], rowTextY, { width: colW[2], align: 'right' });
      doc.text(money(amount),          x + colW[0] + colW[1] + colW[2], rowTextY, { width: colW[3], align: 'right' });

      moveY(rowH);
      subtotalSeen += Number.isFinite(amount) ? amount : 0;
      maxRows--;
    }

    // Hidden rows notice
    if (hiddenCount > 0 && ensureSpace(rowH + 6)) {
      doc.save().rect(x, y, W, rowH).fill(zebra[rowIndex % 2]).restore();
      doc.font('Helvetica-Oblique').fontSize(9).fillColor(gray6)
         .text(`+ ${hiddenCount} more item${hiddenCount > 1 ? 's' : ''} included in totals`, x + 8, y + 4, { width: W - 16 });
      moveY(rowH);
    }

    // Totals
    if (!ensureSpace(70)) return; // bail if we really can't fit totals (very rare)

    doc.moveTo(x, y).lineTo(R, y).strokeColor(line).stroke();
    moveY(8);

    const labelW = 140;
    const valW   = 120;
    const valX   = R - valW;
    const labelX = valX - labelW - 8;

    const totalLine = (label, val, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(bold ? ink : gray6)
         .text(label, labelX, y, { width: labelW, align: 'right' });
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(ink)
         .text(money(val || 0), valX, y, { width: valW, align: 'right' });
      moveY(16);
    };

    totalLine('Subtotal', subtotalEx);
    totalLine(`VAT (${Math.round(vatRate * 100)}%)`, vatAmt);
    totalLine(monthly ? 'Total / month' : 'Total (once-off)', totalInc, true);
  };

  // Stamp (first page only)
  paintStamp(inv?.stamp);

  // Sections
  table('Once-off Charges', inv?.itemsOnceOff || [], onceSub, onceVat, onceTotal, false);
  table('Monthly Charges',  inv?.itemsMonthly || [], monSub,  monVat,  monTotal,  true);

  // Amount Due band
  if (ensureSpace(40)) {
    const yBand = y + 4;
    const bandH = 30;
    doc.save().roundedRect(L, yBand, W, bandH, 10).fill(pill).restore();
    doc.roundedRect(L, yBand, W, bandH, 10).strokeColor(line).stroke();
    doc.font('Helvetica-Bold').fontSize(12).fillColor(ink)
       .text('Amount Due (incl VAT)', L + 12, yBand + 7);
    doc.text(money(grandPayNow), L, yBand + 7, { width: W - 12, align: 'right' });
    doc.y = yBand + bandH + 8; y = doc.y;
  }

  // Notes (only if they fit)
  const blurb = [
    'Included: Professional install & device setup; Remote support; PBX configuration; Number porting assistance. Standard call-out fee: R450.',
    inv?.notes ? `Notes: ${inv.notes}` : '',
    'Payment terms: once-off on installation; monthly fees billed in advance.'
  ].filter(Boolean).join('\n');

  const notesH = doc.heightOfString(blurb, { width: W });
  if (ensureSpace(notesH + 8)) {
    doc.font('Helvetica').fontSize(9).fillColor(gray6).text(blurb, L, undefined, { width: W });
  }

  // Footer
  const yFooter = doc.page.height - 30;
  doc.font('Helvetica').fontSize(9).fillColor(gray4)
     .text(`${inv?.company?.name || 'Company'} • ${inv?.company?.email || ''} • ${inv?.company?.phone || ''}`, L, yFooter, { width: W, align: 'left' })
     .text(`Page 1`, L, yFooter, { width: W, align: 'right' });

  doc.end();
  return done;
}
