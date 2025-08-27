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

/**
 * Build QUOTE PDF buffer — 2-page Apple-ish layout.
 * Page 1: Logo, title, cards (Quote Info, Bill To, Totals), Included/Notes.
 * Page 2: Once-off & Monthly tables, Pay-now band, footer.
 *
 * @param {{
 *   quoteNumber:string, dateISO:string, validDays:number,
 *   client:{name?:string, company?:string, email?:string, phone?:string, address?:string},
 *   itemsOnceOff:Array<{name:string, qty:number, unit:number, minutes?:number}>,
 *   itemsMonthly:Array<{name:string, qty:number, unit:number, minutes?:number}>,
 *   subtotals:{ onceOff:number, monthly:number },
 *   notes?:string, stamp?:string, compact?:boolean,
 *   company:{
 *     name:string, address?:string, phone?:string, email?:string, vatRate:number,
 *     logoUrl?:string,
 *     colors?:{brand?:string, ink?:string, gray6?:string, gray4?:string, line?:string, thbg?:string, pill?:string}
 *   }
 * }} q
 * @returns {Promise<Buffer>}
 */
export async function buildQuotePdfBuffer(q) {
  const compact = !!q.compact;

  // Theme defaults (gentle, neutral; tweak here if you want)
  const theme = {
    brand: q.company?.colors?.brand || '#0B63E6',
    ink:   q.company?.colors?.ink   || '#111111',
    gray6: q.company?.colors?.gray6 || '#4b5563',
    gray4: q.company?.colors?.gray4 || '#6b7280',
    line:  q.company?.colors?.line  || '#e5e7eb',
    thbg:  q.company?.colors?.thbg  || '#f7f8fa',
    pill:  q.company?.colors?.pill  || '#f5f5f7',
  };

  // Page & margins (wider margins to feel airy)
  const margin = compact ? 44 : 56;
  const doc = new PDFDocument({ size: 'A4', margin, bufferPages: true });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // Bounds
  const L = doc.page.margins.left;
  const R = doc.page.width - doc.page.margins.right;
  const W = R - L;

  const { brand, ink, gray6, gray4, line, thbg, pill } = theme;

  const datePretty = (() => {
    try { return new Date(q.dateISO).toISOString().slice(0, 10); } catch { return String(q.dateISO || '').slice(0, 10); }
  })();

  const vatRate = Number(q.company?.vatRate ?? 0.15);
  const onceSub = Number(q.subtotals?.onceOff || 0);
  const monSub  = Number(q.subtotals?.monthly || 0);
  const onceVat = onceSub * vatRate;
  const monVat  = monSub * vatRate;
  const onceTotal = onceSub + onceVat;
  const monTotal  = monSub + monVat;
  const grandPayNow = onceTotal + monTotal;

  // ---------- Small helpers ----------
  const spacer = (h) => { doc.y += h; };
  const rule = (y, thick = 1) => {
    doc.save().moveTo(L, y).lineTo(R, y).lineWidth(thick).strokeColor(line).stroke().restore();
  };
  const sectionTitle = (title, y = doc.y) => {
    doc.font('Helvetica-Bold').fontSize(compact ? 12 : 13).fillColor(ink)
       .text(title, L, y, { width: W });
    spacer(compact ? 6 : 8);
  };
  const caption = (text, x, y, width = 200, align = 'left') => {
    doc.font('Helvetica').fontSize(9).fillColor(gray6)
       .text(text, x, y, { width, align });
  };
  const label = (text, x, y, width = 200, align = 'left') => {
    doc.font('Helvetica').fontSize(10).fillColor(gray6)
       .text(text, x, y, { width, align });
  };
  const value = (text, x, y, width = 200, align = 'left', bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(11).fillColor(ink)
       .text(text, x, y, { width, align });
  };

  const card = ({ x, y, w, h, radius = 14, fill = pill, stroke = line }) => {
    doc.save().roundedRect(x, y, w, h, radius).fill(fill).restore();
    doc.save().roundedRect(x, y, w, h, radius).lineWidth(1).strokeColor(stroke).stroke().restore();
  };

  const chip = (txt, x, y) => {
    const padX = 8, padY = 4;
    const width = doc.widthOfString(txt) + padX * 2;
    const height = 16 + padY;
    doc.save().roundedRect(x, y, width, height, 10).fill('#E7F0FF').restore();
    doc.save().roundedRect(x, y, width, height, 10).strokeColor('#D7E6FF').stroke().restore();
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0B63E6').text(txt, x + padX, y + 5);
    return { w: width, h: height };
  };

  const unitText = (it, monthly) => {
    const looksLikeCalls = /call|minute/i.test(it.name);
    const minutes = it.minutes;
    if (monthly && (minutes != null || looksLikeCalls)) {
      const m = Number(minutes) || 0;
      return m > 0 ? `${m} minutes` : 'Included minutes';
    }
    return money(it.unit);
  };

  const addFooter = () => {
    const y = doc.page.height - 32;
    doc.font('Helvetica').fontSize(9).fillColor(gray4)
      .text(`${q.company.name} • ${q.company.email || ''} • ${q.company.phone || ''}`, L, y, { width: W, align: 'left' })
      .text(`Page ${doc.page.number}`, L, y, { width: W, align: 'right' });
  };

  const paintStamp = (text) => {
    if (!text) return;
    doc.save();
    doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font('Helvetica-Bold').fontSize(90).fillColor('#EEF2FF').opacity(0.7)
       .text(text, doc.page.width * 0.1, doc.page.height * 0.25, { width: doc.page.width * 0.8, align: 'center' });
    doc.opacity(1).restore();
  };

  // ---------- HEADER (Page 1) ----------
  // Thin brand bar
  doc.save().rect(0, 0, doc.page.width, 6).fill(brand).restore();

  const headerTop = 26;
  const logoBuf = await loadLogoBuffer(q.company?.logoUrl);
  if (logoBuf) {
    try { doc.image(logoBuf, L, headerTop, { width: compact ? 128 : 148 }); } catch {}
  } else {
    doc.font('Helvetica-Bold').fontSize(16).fillColor(ink).text(q.company?.name || 'Company', L, headerTop);
  }

  // Right side: Quote title + meta
  const titleX = L + (compact ? 260 : 280);
  const titleW = R - titleX;
  doc.font('Helvetica-Bold').fontSize(compact ? 22 : 24).fillColor(ink)
     .text('Quote', titleX, headerTop, { width: titleW, align: 'right' });
  spacer(compact ? 0 : 2);
  doc.font('Helvetica').fontSize(10).fillColor(gray6)
     .text(`Quote #: ${q.quoteNumber}`, titleX, doc.y, { width: titleW, align: 'right' })
     .text(`Date: ${datePretty}`,      titleX, doc.y,   { width: titleW, align: 'right' })
     .text(`Valid: ${Number(q.validDays || 7)} days`, titleX, doc.y, { width: titleW, align: 'right' });

  spacer(compact ? 14 : 18);

  // ---------- PAGE 1 CARDS GRID ----------
  // Grid: 3 cards side-by-side (stack if narrow margins)
  const gap = 12;
  const col = (W - gap * 2) / 3;
  let y = Math.max(doc.y + (compact ? 10 : 14), headerTop + (compact ? 72 : 78));

  // Card A: Quote Info
  const aH = compact ? 108 : 120;
  card({ x: L, y, w: col, h: aH });
  caption('Quote Info', L + 14, y + 10);
  let ty = y + 30;
  label('Company', L + 14, ty);   value(q.company?.name || '', L + 14, ty + 13, col - 28); ty += 32;
  label('Email',   L + 14, ty);   value(q.company?.email || '', L + 14, ty + 13, col - 28); ty += 32;
  label('Phone',   L + 14, ty);   value(q.company?.phone || '', L + 14, ty + 13, col - 28);

  // Card B: Bill To
  card({ x: L + col + gap, y, w: col, h: aH });
  caption('Bill To', L + col + gap + 14, y + 10);
  ty = y + 30;
  value(q.client?.name || '',     L + col + gap + 14, ty, col - 28, 'left', true); ty += 20;
  value(q.client?.company || '',  L + col + gap + 14, ty, col - 28); ty += 16;
  label('Email',  L + col + gap + 14, ty); value(q.client?.email || '',  L + col + gap + 14, ty + 13, col - 28); ty += 32;
  label('Phone',  L + col + gap + 14, ty); value(q.client?.phone || '',  L + col + gap + 14, ty + 13, col - 28);

  // Card C: Totals
  const cH = compact ? 108 : 120;
  card({ x: L + (col + gap) * 2, y, w: col, h: cH });
  const cx = L + (col + gap) * 2 + 14;
  caption('Totals (incl. VAT)', cx, y + 10);
  ty = y + 32;
  label('Monthly', cx, ty);     value(money(monTotal), cx, ty + 13, col - 28, 'left', true); ty += 34;
  label('Once-off', cx, ty);    value(money(onceTotal), cx, ty + 13, col - 28, 'left', true); ty += 34;

  // Badges
  chip('VAT included', cx, y + cH - 24);

  y += Math.max(aH, cH);
  spacer(compact ? 14 : 18);

  // Card D: Included / Notes (full-width)
  const dH = compact ? 110 : 120;
  card({ x: L, y, w: W, h: dH });
  caption('What’s Included', L + 14, y + 10);
  const blurb = [
    '• Professional install & device setup',
    '• Remote support',
    '• PBX configuration',
    '• Number porting assistance',
    '• Standard call-out fee: R450',
  ].join('\n');

  doc.font('Helvetica').fontSize(10).fillColor(ink)
     .text(blurb, L + 14, y + 30, { width: W - 28 });

  if (q.notes) {
    const nx = L + (W * 0.52);
    const nw = W - (nx - L) - 14;
    caption('Notes', nx, y + 10);
    doc.font('Helvetica').fontSize(10).fillColor(ink)
       .text(q.notes, nx, y + 30, { width: nw });
  }

  // Footer & stamp for Page 1
  paintStamp(q.stamp);
  addFooter();

  // ---------- Force Page Break (start Page 2) ----------
  doc.addPage();
  paintStamp(q.stamp);

  // Repeat thin brand bar for continuity
  doc.save().rect(0, 0, doc.page.width, 6).fill(brand).restore();

  spacer(compact ? 16 : 20);
  sectionTitle('Details');

  // ---------- TABLES (Page 2) ----------
  const renderTable = (title, items, subtotalEx, vatAmt, totalInc, monthly = false) => {
    const colW = [ W * 0.60, W * 0.12, W * 0.12, W * 0.16 ];
    const rowH = compact ? 20 : 24;
    const headH = compact ? 18 : 20;

    // Section card
    const cardTop = doc.y;
    let innerY = cardTop + (compact ? 8 : 10);
    const paddingX = 14;
    const minBodyH = (items?.length || 0) * rowH + headH + (compact ? 62 : 70);
    const estCardH = Math.max(minBodyH, compact ? 120 : 132);

    // Draw card block
    card({ x: L, y: cardTop, w: W, h: estCardH });
    // Title
    doc.font('Helvetica-Bold').fontSize(12).fillColor(ink).text(title, L + paddingX, innerY);
    innerY += compact ? 6 : 8;

    // Header row
    doc.save().rect(L, innerY, W, headH).fill(thbg).restore();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(ink);
    const headY = innerY + (compact ? 3 : 5);
    doc.text('Description', L + paddingX, headY, { width: colW[0] - (paddingX + 2) });
    doc.text('Qty',         L + colW[0],   headY, { width: colW[1], align: 'right' });
    doc.text('Unit',        L + colW[0] + colW[1], headY, { width: colW[2], align: 'right' });
    doc.text('Amount',      L + colW[0] + colW[1] + colW[2], headY, { width: colW[3] - paddingX, align: 'right' });

    doc.moveTo(L, innerY + headH).lineTo(R, innerY + headH).strokeColor(line).stroke();
    innerY += headH + 2;

    // Body
    doc.font('Helvetica').fontSize(10).fillColor(ink);
    const zebra = ['#ffffff', '#fbfdff'];
    let rowIndex = 0;

    if (!items?.length) {
      doc.text('No items.', L + paddingX, innerY, { width: W - paddingX * 2 });
      innerY += rowH;
    } else {
      for (const it of items) {
        // row background
        doc.save().rect(L, innerY, W, rowH).fill(zebra[rowIndex % 2]).restore();
        rowIndex++;
        const yTxt = innerY + (compact ? 4 : 6);
        const qty    = Number(it.qty || 1);
        const amount = (Number(it.unit) || 0) * qty;

        doc.text(String(it.name || ''), L + paddingX, yTxt, { width: colW[0] - (paddingX + 2) });
        doc.text(String(qty),           L + colW[0], yTxt,   { width: colW[1], align: 'right' });
        doc.text(unitText(it, monthly), L + colW[0] + colW[1], yTxt, { width: colW[2], align: 'right' });
        doc.text(money(amount),         L + colW[0] + colW[1] + colW[2], yTxt, { width: colW[3] - paddingX, align: 'right' });

        innerY += rowH;
      }
    }

    // Totals inside the card
    doc.moveTo(L, innerY).lineTo(R, innerY).strokeColor(line).stroke();
    innerY += compact ? 8 : 10;

    const labelW = compact ? 130 : 140;
    const valW   = compact ? 110 : 120;
    const valX   = R - paddingX - valW;
    const labelX = valX - labelW - 8;

    const totalLine = (lbl, val, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(bold ? ink : gray6)
        .text(lbl, labelX, innerY, { width: labelW, align: 'right' });
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(ink)
        .text(money(val), valX, innerY, { width: valW, align: 'right' });
      innerY += compact ? 14 : 16;
    };

    totalLine('Subtotal', subtotalEx);
    totalLine(`VAT (${Math.round(vatRate * 100)}%)`, vatAmt);
    totalLine(monthly ? 'Total / month' : 'Total (once-off)', totalInc, true);

    // Adjust doc.y to end of card
    const cardBottom = Math.max(innerY + (compact ? 8 : 10), cardTop + estCardH);
    doc.y = cardBottom + (compact ? 12 : 16);
  };

  renderTable('Once-off Charges', q.itemsOnceOff || [], onceSub, onceVat, onceTotal, false);
  renderTable('Monthly Charges',  q.itemsMonthly || [], monSub,  monVat,  monTotal,  true);

  // ---------- Pay-now band (subtle pill) ----------
  const bandH = compact ? 34 : 38;
  const bandY = doc.y;
  card({ x: L, y: bandY, w: W, h: bandH, radius: 12 });
  doc.font('Helvetica-Bold').fontSize(12).fillColor(ink)
     .text('Pay now (incl VAT)', L + 14, bandY + (compact ? 7 : 9));
  doc.font('Helvetica-Bold').fontSize(12).fillColor(ink)
     .text(money(grandPayNow), L, bandY + (compact ? 7 : 9), { width: W - 14, align: 'right' });

  // Footer
  addFooter();

  // Page-added hook to keep footer/stamp consistent
  doc.on('pageAdded', () => {
    paintStamp(q.stamp);
    addFooter();
  });

  doc.end();
  return done;
}
