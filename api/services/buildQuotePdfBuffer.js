export async function buildQuotePdfBuffer(q) {
  const compact = !!q.compact;

  // ---- Theme (with safe defaults so missing colors won't crash) ----
  const theme = {
    brand: q.company?.colors?.brand || '#0B63E6',
    ink:   q.company?.colors?.ink   || '#111111',
    gray6: q.company?.colors?.gray6 || '#4b5563',
    gray4: q.company?.colors?.gray4 || '#6b7280',
    line:  q.company?.colors?.line  || '#e5e7eb',
    thbg:  q.company?.colors?.thbg  || '#f5f5f7',
    pill:  q.company?.colors?.pill  || '#f5f5f7',
  };

  // ---- Money / date helpers ----
  const money = (n) =>
    'R ' + Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const datePretty = (() => {
    try { return new Date(q.dateISO).toISOString().slice(0, 10); }
    catch { return String(q.dateISO || '').slice(0, 10); }
  })();

  // ---- Totals ----
  const vatRate   = Number(q.company?.vatRate ?? 0.15);
  const onceSub   = Number(q.subtotals?.onceOff || 0);
  const monSub    = Number(q.subtotals?.monthly || 0);
  const onceVat   = onceSub * vatRate;
  const monVat    = monSub  * vatRate;
  const onceTotal = onceSub + onceVat;
  const monTotal  = monSub  + monVat;
  const grandPayNow = onceTotal + monTotal;

  // ---- PDF ----
  const margin = compact ? 40 : 48; // slightly more room
  const doc = new PDFDocument({ size: 'A4', margin });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const L = doc.page.margins.left;
  const R = doc.page.width - doc.page.margins.right;
  const T = doc.page.margins.top;
  const B = doc.page.height - doc.page.margins.bottom;
  const W = R - L;

  const { brand, ink, gray6, gray4, line, thbg, pill } = theme;

  // ---- Page count (fix "Page undefined") ----
  let pageNo = 1;
  const addFooter = () => {
    const y = doc.page.height - 30;
    doc.font('Helvetica').fontSize(9).fillColor(gray4)
      .text(`${q.company.name} • ${q.company.email || ''} • ${q.company.phone || ''}`, L, y, { width: W, align: 'left' })
      .text(`Page ${pageNo}`, L, y, { width: W, align: 'right' });
  };
  doc.on('pageAdded', () => { pageNo += 1; paintStamp(q.stamp); addFooter(); });

  // ---- Stamp ----
  function paintStamp(text) {
    if (!text) return;
    doc.save();
    doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font('Helvetica-Bold').fontSize(90).fillColor('#EEF2FF').opacity(0.7)
       .text(text, doc.page.width * 0.1, doc.page.height * 0.25, {
         width: doc.page.width * 0.8, align: 'center'
       });
    doc.opacity(1).restore();
  }

  // ---- Header bar ----
  doc.save().rect(0, 0, doc.page.width, 6).fill(brand).restore();

  // ---- Header (logo + meta) ----
  const headerTop = T + 16;
  const logoBuf = await loadLogoBuffer(q.company?.logoUrl);
  if (logoBuf) {
    try { doc.image(logoBuf, L, headerTop, { width: compact ? 120 : 140 }); } catch {}
  } else {
    doc.font('Helvetica-Bold').fontSize(16).fillColor(ink).text(q.company?.name || 'Company', L, headerTop);
  }

  const titleX = L + (compact ? 260 : 280);
  const titleW = R - titleX;
  doc.font('Helvetica-Bold').fontSize(compact ? 20 : 22).fillColor(ink)
     .text('Quote', titleX, headerTop, { width: titleW, align: 'right' });
  doc.font('Helvetica').fontSize(10).fillColor(gray6)
     .text(`Quote #: ${q.quoteNumber}`, titleX, doc.y + 2, { width: titleW, align: 'right' })
     .text(`Date: ${datePretty}`,       titleX, doc.y,     { width: titleW, align: 'right' })
     .text(`Valid: ${Number(q.validDays || 7)} days`, titleX, doc.y, { width: titleW, align: 'right' });

  // ---- Company / Bill To blocks ----
  doc.moveDown(compact ? 1.4 : 1.8);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(ink)
    .text(q.company.name, L, undefined, { width: W });
  doc.font('Helvetica').fontSize(10).fillColor(gray6)
    .text(q.company.address || '', L, undefined, { width: W })
    .text(`${q.company.phone || ''}${q.company.email ? ' • ' + q.company.email : ''}`, L, undefined, { width: W });

  doc.moveDown(compact ? 0.9 : 1.1);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(ink).text('Bill To', L, undefined, { width: W });
  doc.font('Helvetica').fontSize(10).fillColor(ink)
    .text(q.client?.name || '', L, undefined, { width: W })
    .text(q.client?.company || '', L, undefined, { width: W })
    .text(q.client?.email || '', L, undefined, { width: W })
    .text(q.client?.phone || '', L, undefined, { width: W })
    .text(q.client?.address || '', L, undefined, { width: W });

  // Subtle divider before cards
  doc.moveTo(L, doc.y + 6).lineTo(R, doc.y + 6).strokeColor(line).dash(1, { space: 2 }).stroke().undash();
  doc.y += compact ? 10 : 12;

  // ---- Summary cards (more breathing room) ----
  const yStart = doc.y + (compact ? 14 : 18);
  const gap = compact ? 14 : 16;
  const cardH = compact ? 48 : 52;
  const cardW = (W - gap) / 2;

  const card = (x, y, w, h, title, val, subtitle) => {
    doc.save().roundedRect(x, y, w, h, 12).fill(pill).restore();
    doc.roundedRect(x, y, w, h, 12).strokeColor(line).stroke();
    doc.font('Helvetica').fontSize(9).fillColor(gray6).text(title, x + 12, y + 8);
    doc.font('Helvetica-Bold').fontSize(compact ? 13 : 14).fillColor(ink).text(val, x + 12, y + 24);
    if (subtitle) {
      doc.font('Helvetica').fontSize(9).fillColor(gray6)
        .text(subtitle, x + w - 72, y + 24, { width: 60, align: 'right' });
    }
  };
  card(L, yStart, cardW, cardH, 'MONTHLY', money(monTotal), '/month');
  card(L + cardW + gap, yStart, cardW, cardH, 'ONCE-OFF', money(onceTotal), 'setup');

  doc.y = yStart + cardH + (compact ? 16 : 20);

  // ---- Unit text (shorter to avoid wraps) ----
  const unitText = (it, monthly) => {
    const looksLikeCalls = /call|minute/i.test(it.name);
    if (monthly && (it.minutes != null || looksLikeCalls)) {
      const m = Number(it.minutes) || 0;
      return m > 0 ? `${m} min` : 'Included';
    }
    return money(it.unit);
  };

  // ---- Table renderer (cap total doc pages at 2) ----
  const maxPages = 2;
  const table = (title, items, subtotalEx, vatAmt, totalInc, monthly = false) => {
    // widen Unit col to prevent wraps
    const colW = [ W * 0.56, W * 0.12, W * 0.14, W * 0.18 ];
    const rowH = compact ? 20 : 22;
    const headH = compact ? 18 : 20;
    let y = doc.y;

    doc.font('Helvetica-Bold').fontSize(12).fillColor(ink).text(title, L, y, { width: W });
    y = doc.y + (compact ? 4 : 6);

    // Header
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

    const ensureRowSpaceOrStop = () => {
      const pageBottom = B;
      if (y + rowH <= pageBottom) return true;
      // need new page? only if less than maxPages
      if (pageNo < maxPages) {
        doc.addPage(); // pageNo increments by listener
        y = doc.y;
        // header bar for new page for continuity
        doc.save().rect(0, 0, doc.page.width, 6).fill(brand).restore();
        return true;
      }
      return false; // cannot add more pages
    };

    if (!Array.isArray(items) || items.length === 0) {
      if (ensureRowSpaceOrStop()) {
        doc.text('No items.', L + 8, y, { width: W - 16 });
        y += rowH;
      }
    } else {
      let hiddenCount = 0;
      for (let i = 0; i < items.length; i++) {
        if (!ensureRowSpaceOrStop()) { hiddenCount = items.length - i; break; }
        const it = items[i];
        const qty    = Number(it.qty || 1);
        const amount = (Number(it.unit) || 0) * qty;

        // Row background
        doc.save().rect(L, y, W, rowH).fill(zebra[rowIndex % 2]).restore();
        rowIndex++;

        const yTxt = y + (compact ? 4 : 5);
        doc.text(String(it.name || ''),           L + 8, yTxt, { width: colW[0] - 10 });
        doc.text(String(qty),                     L + colW[0], yTxt, { width: colW[1], align: 'right' });
        doc.text(unitText(it, monthly),           L + colW[0] + colW[1], yTxt, { width: colW[2], align: 'right' });
        doc.text(money(amount),                   L + colW[0] + colW[1] + colW[2], yTxt, { width: colW[3], align: 'right' });

        y += rowH;
      }
      if (hiddenCount > 0 && ensureRowSpaceOrStop()) {
        doc.save().rect(L, y, W, rowH).fill(zebra[rowIndex % 2]).restore();
        doc.font('Helvetica-Oblique').fontSize(9).fillColor(gray6)
           .text(`+ ${hiddenCount} more item${hiddenCount > 1 ? 's' : ''} included in totals`,
                 L + 8, y + (compact ? 4 : 5), { width: W - 16, align: 'left' });
        y += rowH;
      }
    }

    // Totals block (try to fit, else compact vertically)
    const totLines = [
      ['Subtotal', subtotalEx, false],
      [`VAT (${Math.round(vatRate * 100)}%)`, vatAmt, false],
      [monthly ? 'Total / month' : 'Total (once-off)', totalInc, true],
    ];
    const lineH = compact ? 14 : 16;
    const need = (compact ? 8 : 10) + lineH * totLines.length;

    const writeTotals = () => {
      doc.moveTo(L, y).lineTo(R, y).strokeColor(line).stroke();
      y += compact ? 8 : 10;
      const labelW = compact ? 130 : 140;
      const valW   = compact ? 110 : 120;
      const valX   = R - valW;
      const labelX = valX - labelW - 8;
      for (const [lbl, val, bold] of totLines) {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(bold ? ink : gray6)
          .text(lbl, labelX, y, { width: labelW, align: 'right' });
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(ink)
          .text(money(val), valX, y, { width: valW, align: 'right' });
        y += lineH;
      }
    };

    if (y + need <= B || (pageNo < maxPages && (doc.addPage(), doc.save().rect(0, 0, doc.page.width, 6).fill(brand).restore(), y = doc.y, true))) {
      writeTotals();
    }

    doc.y = y + (compact ? 4 : 6);
  };

  // ---- Paint stamp on first page ----
  paintStamp(q.stamp);

  // ---- Sections (same order you had) ----
  table('Once-off Charges', q.itemsOnceOff || [], onceSub, onceVat, onceTotal, false);
  doc.moveDown(compact ? 0.6 : 0.8);
  table('Monthly Charges',  q.itemsMonthly || [], monSub,  monVat,  monTotal,  true);
  doc.moveDown(compact ? 1.0 : 1.2);

  // ---- Pay-now band ----
  const yBand = doc.y + 4;
  const bandH = compact ? 30 : 34;
  doc.save().roundedRect(L, yBand, W, bandH, 10).fill(pill).restore();
  doc.roundedRect(L, yBand, W, bandH, 10).strokeColor(line).stroke();
  doc.font('Helvetica-Bold').fontSize(12).fillColor(ink)
    .text('Pay now (incl VAT)', L + 12, yBand + (compact ? 7 : 9));
  doc.text(money(grandPayNow), L, yBand + (compact ? 7 : 9), { width: W - 12, align: 'right' });

  // ---- Notes / Included ----
  doc.moveDown(compact ? 1.4 : 1.8);
  const blurb = [
    'Included: Professional install & device setup; Remote support; PBX configuration; Number porting assistance. Standard call-out fee: R450.',
    q.notes ? `Notes: ${q.notes}` : '',
    `This quote is valid for ${Number(q.validDays || 7)} days. Pricing in ZAR.`
  ].filter(Boolean).join('\n');
  doc.font('Helvetica').fontSize(9).fillColor(gray6).text(blurb, L, undefined, { width: W });

  // ---- Footer (page 1) ----
  addFooter();

  // ---- End. (Max 2 pages ensured in table renderer; we never call addPage() elsewhere) ----
  doc.end();
  return done;
}
