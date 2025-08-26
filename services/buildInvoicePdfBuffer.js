// services/buildInvoicePdfBuffer.js
import PDFDocument from 'pdfkit';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helpers
const money = (n) =>
  'R ' + Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
 * Build INVOICE PDF buffer (matches send-quote.js look & feel)
 * @param {{
 *   invoiceNumber:string, orderNumber:string, dateISO:string, dueDays:number,
 *   client:{name?:string, company?:string, email?:string, phone?:string, address?:string},
 *   itemsOnceOff:Array<{name:string, qty:number, unit:number, minutes?:number}>,
 *   itemsMonthly:Array<{name:string, qty:number, unit:number, minutes?:number}>,
 *   subtotals:{ onceOff:number, monthly:number },
 *   notes?:string, stamp?:string, compact?:boolean,
 *   company:{ name:string, address?:string, phone?:string, email?:string, vatRate:number,
 *             logoUrl?:string, colors?:{brand:string, ink:string, gray6:string, gray4:string, line:string, thbg:string, pill:string} }
 * }} inv
 * @returns {Promise<Buffer>}
 */
export async function buildInvoicePdfBuffer(inv) {
  const compact = !!inv.compact;

  const margin = compact ? 40 : 46;
  const doc = new PDFDocument({ size: 'A4', margin });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const L = doc.page.margins.left;
  const R = doc.page.width - doc.page.margins.right;
  const W = R - L;

  const { brand, ink, gray6, gray4, line, thbg, pill } = inv.company.colors;

  // Optional watermark/stamp (e.g. PAID)
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
  const logoBuf = await loadLogoBuffer(inv.company.logoUrl);
  if (logoBuf) {
    try { doc.image(logoBuf, L, headerTop, { width: compact ? 130 : 150 }); } catch {}
  } else {
    doc.font('Helvetica-Bold').fontSize(16).fillColor(ink).text(inv.company.name, L, headerTop);
  }

  const datePretty = (() => {
    try { return new Date(inv.dateISO).toISOString().slice(0, 10); }
    catch { return String(inv.dateISO || '').slice(0, 10); }
  })();

  doc.font('Helvetica-Bold').fontSize(compact ? 20 : 22).fillColor(ink)
     .text('Invoice', L, headerTop, { width: W, align: 'right' }).moveDown(0.2);

  doc.font('Helvetica').fontSize(10).fillColor(gray6)
     .text(`Invoice #: ${inv.invoiceNumber}`, L, undefined, { width: W, align: 'right' })
     .text(`Order #: ${inv.orderNumber}`,    L, undefined, { width: W, align: 'right' })
     .text(`Date: ${datePretty}`,            L, undefined, { width: W, align: 'right' })
     .text(`Due: ${Number(inv.dueDays || 7)} days`, L, undefined, { width: W, align: 'right' });

  // Company block
  doc.moveDown(compact ? 1.5 : 2);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(ink).text(inv.company.name, L, undefined, { width: W });
  doc.font('Helvetica').fontSize(10).fillColor(gray6)
     .text(inv.company.address || '', L, undefined, { width: W })
     .text(`${inv.company.phone || ''}${inv.company.email ? ' • ' + inv.company.email : ''}`, L, undefined, { width: W });

  // Client block
  doc.moveDown(compact ? 1.0 : 1.2);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(ink).text('Bill To', L, undefined, { width: W });
  doc.font('Helvetica').fontSize(10).fillColor(ink)
     .text(inv.client?.name || '', L, undefined, { width: W })
     .text(inv.client?.company || '', L, undefined, { width: W })
     .text(inv.client?.email || '', L, undefined, { width: W })
     .text(inv.client?.phone || '', L, undefined, { width: W })
     .text(inv.client?.address || '', L, undefined, { width: W });

  // Totals
  const vatRate = Number(inv.company.vatRate ?? 0.15);
  const onceSub = Number(inv.subtotals.onceOff || 0);
  const monSub  = Number(inv.subtotals.monthly || 0);
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

  // Table renderer
  const table = (title, items, subtotalEx, vatAmt, totalInc, monthly = false) => {
    const colW = [ W * 0.58, W * 0.12, W * 0.12, W * 0.18 ];
    const rowH = compact ? 20 : 24;
    const headH = compact ? 18 : 20;
    let y = doc.y;

    doc.font('Helvetica-Bold').fontSize(12).fillColor(ink).text(title, L, y, { width: W });
    y = doc.y + (compact ? 4 : 6);

    doc.save().rect(L, y, W, headH).fill(thbg).restore();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(ink);
    const headY = y + (compact ? 3 : 5);
    doc.text('Description', L + 8, headY, { width: colW[0] - 10 });
    doc.text('Qty',         L + colW[0], headY, { width: colW[1], align: 'right' });
    doc.text('Unit',        L + colW[0] + colW[1], headY, { width: colW[2], align: 'right' });
    doc.text('Amount',      L + colW[0] + colW[1] + colW[2], headY, { width: colW[3], align: 'right' });
    doc.moveTo(L, y + headH).lineTo(R, y + headH).strokeColor(line).stroke();
    y += headH + 2;

    doc.font('Helvetica').fontSize(10).fillColor(ink);
    const zebra = ['#ffffff', '#fbfdff'];
    let rowIndex = 0;

    const ensureSpace = (need = 140) => {
      if (y > doc.page.height - need) {
        doc.addPage();
        paintStamp(inv.stamp);
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

  // First-page stamp
  paintStamp(inv.stamp);

  // Sections
  table('Once-off Charges', inv.itemsOnceOff, onceSub, onceVat, onceTotal, false);
  doc.moveDown(compact ? 0.6 : 0.8);
  table('Monthly Charges', inv.itemsMonthly, monSub, monVat, monTotal, true);
  doc.moveDown(compact ? 1.0 : 1.2);

  // Pay-now band
  const yBand = doc.y + 4;
  const bandH = compact ? 30 : 34;
  doc.save().roundedRect(L, yBand, W, bandH, 10).fill(pill).restore();
  doc.roundedRect(L, yBand, W, bandH, 10).strokeColor(line).stroke();
  doc.font('Helvetica-Bold').fontSize(12).fillColor(ink)
     .text('Amount Due (incl VAT)', L + 12, yBand + (compact ? 7 : 9));
  doc.text(money(grandPayNow), L, yBand + (compact ? 7 : 9), { width: W - 12, align: 'right' });

  doc.moveDown(compact ? 1.6 : 2.0);

  // Notes
  const blurb = [
    'Included: Professional install & device setup; Remote support; PBX configuration; Number porting assistance. Standard call-out fee: R450.',
    inv.notes ? `Notes: ${inv.notes}` : '',
    `Payment terms: once-off on installation; monthly fees billed in advance.`
  ].filter(Boolean).join('\n');

  doc.font('Helvetica').fontSize(9).fillColor(gray6).text(blurb, L, undefined, { width: W });

  // Footer
  const addFooter = () => {
    const y = doc.page.height - 30;
    doc.font('Helvetica').fontSize(9).fillColor(gray4)
       .text(`${inv.company.name} • ${inv.company.email} • ${inv.company.phone}`, L, y, { width: W, align: 'left' })
       .text(`Page ${doc.page.number}`, L, y, { width: W, align: 'right' });
  };
  addFooter();
  doc.on('pageAdded', () => {
    paintStamp(inv.stamp);
    addFooter();
  });

  doc.end();
  return done;
}
