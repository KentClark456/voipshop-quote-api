export async function buildQuotePdfBuffer(q) {
  const compact = !!q.compact;

  // ---- Theme (soft Apple-ish neutrals) ----
  const theme = {
    brand: q.company?.colors?.brand || '#0B63E6',
    ink:   q.company?.colors?.ink   || '#111111',
    gray6: q.company?.colors?.gray6 || '#4b5563',
    gray4: q.company?.colors?.gray4 || '#6b7280',
    line:  q.company?.colors?.line  || '#e5e7eb',
    thbg:  q.company?.colors?.thbg  || '#f5f5f7',
    pill:  q.company?.colors?.pill  || '#f5f5f7',
    chipBg:'#E7F0FF',
    chipBd:'#D7E6FF',
    chipTx:'#0B63E6',
  };

  // ---- Money / time helpers ----
  const money = (n) =>
    'R ' + Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const datePretty = (() => {
    try { return new Date(q.dateISO).toISOString().slice(0,10); }
    catch { return String(q.dateISO || '').slice(0,10); }
  })();

  // ---- Totals ----
  const vatRate = Number(q.company?.vatRate ?? 0.15);
  const onceSub = Number(q.subtotals?.onceOff || 0);
  const monSub  = Number(q.subtotals?.monthly || 0);
  const onceVat = onceSub * vatRate;
  const monVat  = monSub * vatRate;
  const onceTotal = onceSub + onceVat;
  const monTotal  = monSub + monVat;
  const grandPayNow = onceTotal + monTotal;

  // ---- PDF ----
  const margin = compact ? 44 : 56;
  const doc = new PDFDocument({ size: 'A4', margin });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((r) => doc.on('end', () => r(Buffer.concat(chunks))));

  const L = doc.page.margins.left;
  const R = doc.page.width - doc.page.margins.right;
  const T = doc.page.margins.top;
  const B = doc.page.height - doc.page.margins.bottom;
  const W = R - L;

  const { brand, ink, gray6, gray4, line, thbg, pill, chipBg, chipBd, chipTx } = theme;

  // ---------------- Shared UI helpers ----------------
  const spacer = (h) => { doc.y += h; };
  const card = ({ x, y, w, h, radius = 14, fill = pill, stroke = line }) => {
    doc.save().roundedRect(x, y, w, h, radius).fill(fill).restore();
    doc.save().roundedRect(x, y, w, h, radius).lineWidth(1).strokeColor(stroke).stroke().restore();
  };
  const measure = (text, opt) => doc.heightOfString(String(text || ''), opt);
  const label = (t, x, y, w = 200) => { doc.font('Helvetica').fontSize(10).fillColor(gray6).text(t, x, y, { width: w }); };
  const value = (t, x, y, w = 200, bold=false) => { doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(11).fillColor(ink).text(t, x, y, { width: w }); };
  const caption = (t, x, y, w = 200) => { doc.font('Helvetica').fontSize(9).fillColor(gray6).text(t, x, y, { width: w }); };
  const chip = (txt, x, y) => {
    const padX = 8, padY = 4;
    const w = doc.widthOfString(txt) + padX*2, h = 16+padY;
    doc.save().roundedRect(x,y,w,h,10).fill(chipBg).restore();
    doc.save().roundedRect(x,y,w,h,10).strokeColor(chipBd).stroke().restore();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(chipTx).text(txt, x+padX, y+5);
    return { w, h };
  };
  const unitText = (it, monthly) => {
    const looksLikeCalls = /call|minute/i.test(it.name);
    if (monthly && (it.minutes != null || looksLikeCalls)) {
      const m = Number(it.minutes||0);
      return m > 0 ? `${m} minutes` : 'Included minutes';
    }
    return money(it.unit);
  };
  const addFooter = () => {
    const y = B + 8;
    doc.font('Helvetica').fontSize(9).fillColor(gray4)
      .text(`${q.company.name} • ${q.company.email || ''} • ${q.company.phone || ''}`, L, y, { width: W, align: 'left' })
      .text(`Page ${doc.page.number}`, L, y, { width: W, align: 'right' });
  };

  // ---------------- PAGE 1 ----------------
  // Top brand hairline
  doc.save().rect(0, 0, doc.page.width, 6).fill(brand).restore();

  // Header
  const headerGap = 16;
  const logoBuf = await (async () => {
    try {
      const local = [
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../Assets/Group 1642logo (1).png'),
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../Assets/Group 1642logo (1).png'),
      ];
      for (const p of local) {
        try { const b = await fs.readFile(p); if (b?.length) return b; } catch {}
      }
      if (q.company?.logoUrl && typeof fetch === 'function') {
        const r = await fetch(q.company.logoUrl, { cache: 'no-store' });
        if (r.ok) return Buffer.from(await r.arrayBuffer());
      }
    } catch {}
    return null;
  })();

  let y = T + 22;
  if (logoBuf) { try { doc.image(logoBuf, L, y, { width: compact ? 120 : 140 }); } catch {} }
  else { doc.font('Helvetica-Bold').fontSize(16).fillColor(ink).text(q.company?.name || 'Company', L, y); }

  // Right side meta
  const titleX = L + (compact ? 260 : 280);
  const titleW = R - titleX;
  doc.font('Helvetica-Bold').fontSize(compact ? 22 : 24).fillColor(ink)
     .text('Quote', titleX, y, { width: titleW, align: 'right' });
  doc.font('Helvetica').fontSize(10).fillColor(gray6)
     .text(`Quote #: ${q.quoteNumber}`, titleX, doc.y + 2, { width: titleW, align: 'right' })
     .text(`Date: ${datePretty}`,       titleX, doc.y,     { width: titleW, align: 'right' })
     .text(`Valid: ${Number(q.validDays || 7)} days`, titleX, doc.y, { width: titleW, align: 'right' });

  y = Math.max(doc.y, y) + headerGap;

  // ---- Cards grid (2 columns, balanced) ----
  const GAP = 12;
  const colW = (W - GAP) / 2;

  // Measure heights first, then draw backgrounds, then text (to avoid oversizing/overflow)
  // Card 1: Bill To
  const billToTitle = 'Bill To';
  const billToBody = [
    q.client?.name,
    q.client?.company,
    q.client?.email,
    q.client?.phone,
    q.client?.address
  ].filter(Boolean).join('\n');

  const billTitleH = measure(billToTitle, { width: colW - 28 });
  const billBodyH  = measure(billToBody,  { width: colW - 28 });
  const card1H = 24 + billTitleH + 6 + billBodyH + 10;

  // Card 2: Quote Info
  const qInfoTitle = 'Quote Info';
  const qInfoLines = [
    ['Company', q.company?.name || ''],
    ['Email',   q.company?.email || ''],
    ['Phone',   q.company?.phone || ''],
    ['Address', q.company?.address || ''],
  ];
  const qInfoTitleH = measure(qInfoTitle, { width: colW - 28 });
  const qInfoBodyH  = qInfoLines.reduce((h,[lbl,val]) => {
    return h + measure(lbl, { width: colW - 28 }) + measure(val, { width: colW - 28 }) + 6;
  }, 0);
  const card2H = 24 + qInfoTitleH + 6 + qInfoBodyH + 6;

  // Draw row 1 backgrounds
  card({ x: L,           y, w: colW, h: card1H });
  card({ x: L + colW+GAP, y, w: colW, h: card2H });

  // Populate row 1
  caption(billToTitle, L+14, y+10); doc.font('Helvetica').fontSize(10).fillColor(ink)
    .text(billToBody, L+14, y+10+billTitleH+6, { width: colW-28 });
  const y2 = y;
  caption(qInfoTitle, L+colW+GAP+14, y2+10);
  let ty = y2+10+qInfoTitleH+6;
  for (const [lbl,val] of qInfoLines) {
    label(lbl, L+colW+GAP+14, ty, colW-28); ty += 13;
    value(val, L+colW+GAP+14, ty, colW-28); ty += 19;
  }

  y = Math.max(y + card1H, y2 + card2H) + GAP;

  // Card 3: Totals (full width, balanced row)
  const totalsTitle = 'Totals (incl. VAT)';
  const totalsH = 24 + measure(totalsTitle, { width: W-28 }) + 36 + 10;
  card({ x: L, y, w: W, h: totalsH });
  caption(totalsTitle, L+14, y+10);
  label('Monthly', L+14, y+10+18); value(money(monTotal), L+14, y+10+31, 200, true);
  label('Once-off', L+200, y+10+18); value(money(onceTotal), L+200, y+10+31, 200, true);
  chip('VAT included', R-120, y+totalsH-24);

  y += totalsH + GAP;

  // Card 4: Included / Notes (full width)
  const inclTitle = 'What’s Included';
  const inclPoints = [
    '• Professional install & device setup',
    '• Remote support',
    '• PBX configuration',
    '• Number porting assistance',
    '• Standard call-out fee: R450'
  ].join('\n');
  const inclTitleH = measure(inclTitle, { width: W-28 });
  const inclTextH  = measure(inclPoints, { width: (W-28)/2 });

  const notesTitle = q.notes ? 'Notes' : '';
  const notesTextH = q.notes ? measure(q.notes, { width: (W-28)/2 }) : 0;

  // keep card height balanced between columns
  const innerTopPad = 10, innerGap = 8, bottomPad = 12;
  const colLeftH  = inclTitleH + innerGap + inclTextH;
  const colRightH = (q.notes ? (measure(notesTitle, { width: (W-28)/2 }) + innerGap + notesTextH) : 0);
  const innerH = Math.max(colLeftH, colRightH);
  const card4H = 24 + innerH + bottomPad;

  // If Page 1 is getting tight, clip card 4 a bit by shrinking innerH (but still looks good)
  let remaining = B - (y + card4H + 36);
  if (remaining < 0) {
    // reduce inner height smoothly
    const reduceBy = Math.min(innerH * 0.25, Math.abs(remaining) + 12);
    const newInnerH = innerH - reduceBy;
    const ratio = newInnerH / innerH;
    // proportionally reduce columns (simple approach)
    const newInclH = Math.floor(inclTextH * ratio);
    const newNotesH = q.notes ? Math.floor(notesTextH * ratio) : 0;
    // recompute card4H
    const colLeftH2 = inclTitleH + innerGap + newInclH;
    const colRightH2 = q.notes ? (measure(notesTitle, { width: (W-28)/2 }) + innerGap + newNotesH) : 0;
    const innerH2 = Math.max(colLeftH2, colRightH2);
    const card4H2 = 24 + innerH2 + bottomPad;

    card({ x: L, y, w: W, h: card4H2 });
    // left column
    caption(inclTitle, L+14, y+10);
    doc.font('Helvetica').fontSize(10).fillColor(ink)
       .text(inclPoints, L+14, y+10+inclTitleH+innerGap, { width: (W-28)/2, height: newInclH });
    // right column
    if (q.notes) {
      caption('Notes', L+14 + (W-28)/2 + 14, y+10);
      doc.font('Helvetica').fontSize(10).fillColor(ink)
         .text(q.notes, L+14 + (W-28)/2 + 14, y+10+measure('Notes',{width:(W-28)/2})+innerGap, {
           width: (W-28)/2 - 14, height: newNotesH
         });
    }
    y += card4H2;
  } else {
    // normal draw
    card({ x: L, y, w: W, h: card4H });
    caption(inclTitle, L+14, y+10);
    doc.font('Helvetica').fontSize(10).fillColor(ink)
       .text(inclPoints, L+14, y+10+inclTitleH+innerGap, { width: (W-28)/2 });

    if (q.notes) {
      const nx = L+14 + (W-28)/2 + 14;
      caption('Notes', nx, y+10);
      doc.font('Helvetica').fontSize(10).fillColor(ink)
         .text(q.notes, nx, y+10+measure('Notes',{width:(W-28)/2})+innerGap, { width: (W-28)/2 - 14 });
    }
    y += card4H;
  }

  // Footer page 1
  doc.y = y + 18;
  addFooter();

  // ---------------- PAGE 2 (only once) ----------------
  doc.addPage();

  // hairline
  doc.save().rect(0, 0, doc.page.width, 6).fill(brand).restore();
  let y2p = T + 20;

  // Section title
  doc.font('Helvetica-Bold').fontSize(13).fillColor(ink).text('Details', L, y2p); y2p = doc.y + 10;

  // ---- Table renderer that COMPRESSES to fit remaining space ----
  const renderTable = (title, items, subtotalEx, vatAmt, totalInc, monthly = false) => {
    const colW = [ W * 0.60, W * 0.12, W * 0.12, W * 0.16 ];
    const headH = compact ? 18 : 20;
    let rowH = compact ? 19 : 22; // start roomy; we may compact later
    const padX = 14;

    // Title height + header
    const titleH = measure(title, { width: W - padX*2 });
    const totalsBlockH = (compact ? 40 : 46); // subtotal + VAT + total lines

    // Compute how many rows we can fit in the **remaining space on Page 2**
    const space = (B - 24) - (y2p + 24 + titleH + headH + 8 + totalsBlockH + 16);
    let maxRows = Math.max(0, Math.floor(space / rowH));

    if (maxRows < items.length) {
      // try a gentle compaction
      rowH = Math.max(16, rowH - 3);
      const space2 = (B - 24) - (y2p + 24 + titleH + headH + 8 + totalsBlockH + 16);
      maxRows = Math.max(0, Math.floor(space2 / rowH));
    }

    const visible = items.slice(0, maxRows);
    const hiddenCount = Math.max(0, items.length - visible.length);

    // Card height (calculated)
    const bodyH = (visible.length ? visible.length * rowH : rowH);
    const cardH = 24 + titleH + 8 + headH + 2 + bodyH + 10 + totalsBlockH + 10;

    // If even the empty skeleton won’t fit, shrink fonts slightly
    if (y2p + cardH > B - 12) {
      doc.fontSize(10); // global-ish small nudge
    }

    // Draw card
    card({ x: L, y: y2p, w: W, h: Math.min(cardH, B - y2p - 12) });
    caption(title, L+padX, y2p+10);

    // Header
    let yT = y2p + 10 + titleH + 8;
    doc.save().rect(L, yT, W, headH).fill(thbg).restore();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(ink);
    const headY = yT + (compact ? 3 : 5);
    doc.text('Description', L + padX, headY, { width: colW[0] - (padX + 2) });
    doc.text('Qty',         L + colW[0], headY, { width: colW[1], align: 'right' });
    doc.text('Unit',        L + colW[0] + colW[1], headY, { width: colW[2], align: 'right' });
    doc.text('Amount',      L + colW[0] + colW[1] + colW[2], headY, { width: colW[3] - padX, align: 'right' });
    doc.moveTo(L, yT + headH).lineTo(R, yT + headH).strokeColor(line).stroke();

    // Body
    yT += headH + 2;
    doc.font('Helvetica').fontSize(10).fillColor(ink);
    const zebra = ['#ffffff', '#fbfdff'];
    let i = 0;

    if (!visible.length) {
      doc.text('No items.', L + padX, yT, { width: W - padX*2 });
      yT += rowH;
    } else {
      for (const it of visible) {
        doc.save().rect(L, yT, W, rowH).fill(zebra[i % 2]).restore();
        const yTxt = yT + (rowH <= 18 ? 3 : 5);
        const qty    = Number(it.qty || 1);
        const amount = (Number(it.unit) || 0) * qty;

        doc.text(String(it.name || ''), L + padX, yTxt, { width: colW[0] - (padX + 2) });
        doc.text(String(qty),           L + colW[0], yTxt,   { width: colW[1], align: 'right' });
        doc.text(unitText(it, monthly), L + colW[0] + colW[1], yTxt, { width: colW[2], align: 'right' });
        doc.text(money(amount),         L + colW[0] + colW[1] + colW[2], yTxt, { width: colW[3] - padX, align: 'right' });

        yT += rowH; i++;
      }
      if (hiddenCount > 0) {
        doc.save().rect(L, yT, W, rowH).fill(zebra[i % 2]).restore();
        doc.font('Helvetica-Oblique').fontSize(9).fillColor(gray6)
           .text(`+ ${hiddenCount} more item${hiddenCount>1?'s':''} included in totals`, L + padX, yT + (rowH<=18?3:5), { width: W - padX*2 });
        yT += rowH;
      }
    }

    // Totals
    doc.moveTo(L, yT).lineTo(R, yT).strokeColor(line).stroke();
    yT += 8;
    const labelW = 140, valW = 120, valX = R - padX - valW, labelX = valX - labelW - 8;
    const tLine = (lbl, val, bold=false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(bold ? ink : gray6)
        .text(lbl, labelX, yT, { width: labelW, align: 'right' });
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(ink)
        .text(money(val), valX, yT, { width: valW, align: 'right' });
      yT += 15;
    };
    tLine('Subtotal', subtotalEx);
    tLine(`VAT (${Math.round(vatRate*100)}%)`, vatAmt);
    tLine(monthly ? 'Total / month' : 'Total (once-off)', totalInc, true);

    y2p = yT + 6 + 10; // card padding bottom + gap
  };

  renderTable('Once-off Charges', q.itemsOnceOff || [], onceSub, onceVat, onceTotal, false);
  renderTable('Monthly Charges',  q.itemsMonthly || [], monSub,  monVat,  monTotal,  true);

  // Pay-now band (always fits; compact if needed)
  const bandH = 36, by = Math.min(y2p, B - bandH - 14);
  card({ x: L, y: by, w: W, h: bandH, radius: 12 });
  doc.font('Helvetica-Bold').fontSize(12).fillColor(ink)
     .text('Pay now (incl VAT)', L+14, by+9);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(ink)
     .text(money(grandPayNow), L, by+9, { width: W-14, align: 'right' });

  // Footer page 2
  doc.y = B - 18;
  addFooter();

  // End (no further pages allowed)
  doc.end();
  return done;
}
