  // =========================
  // PAGE 1 — Parties + Services Ordered
  // =========================
  await newPageWithHeader('Service Level Agreement', { align: 'left' });

  // Blue strip with SLA number (Page 1 only)
  if (hasSpace(24)) {
    doc.save();
    doc.rect(L, y, W, 20).fill(BG).strokeColor(BORDER).lineWidth(1).stroke();
    doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(9)
      .text(`Agreement No: ${slaNumber}`, L + 10, y + 6, { continued: true })
      .fillColor(MUTED).font('Helvetica')
      .text('  •  Effective from date of signing');
    moveY(26);
    doc.restore();
  }

  // Parties card
  drawTwoUpCard('Parties — Details (Fill In)',
    ({ lf }) => {
      lf('Provider Name',  company?.name || 'VoIP Shop');
      lf('VAT Number',     company?.vat || '');
      lf('Phone',          company?.phone || '');
      lf('Email',          company?.email || '');
      lf('Website',        company?.website || '');
      lf('Address',        company?.address || '', 120, { lines: 2 });
    },
    ({ rf }) => {
      rf('Customer / Company', customer?.name || customer?.company || '');
      rf('Reg Number',         customer?.reg || '');
      rf('VAT Number',         customer?.vat || '');
      rf('Contact Person',     customer?.contact || '');
      rf('Phone',              customer?.phone || '');
      rf('Email',              customer?.email || '');
      rf('Service Address',    customer?.address || '', 120, { lines: 2 });
    }
  );

  // Services Ordered
  drawCard('Services Ordered (Monthly)', ({ x, w }) => {
    const cW = [ w * 0.52, w * 0.12, w * 0.16, w * 0.20 ];
    const rx = [ x, x + cW[0], x + cW[0] + cW[1], x + cW[0] + cW[1] + cW[2] ];

    doc.font('Helvetica-Bold').fontSize(8.2).fillColor(INK);
    doc.text('Description', rx[0], y, { width: cW[0] });
    doc.text('Qty',         rx[1], y, { width: cW[1], align: 'right' });
    doc.text('Unit Price',  rx[2], y, { width: cW[2], align: 'right' });
    doc.text('Line Total',  rx[3], y, { width: cW[3], align: 'right' });
    moveY(8);
    doc.moveTo(x, y).lineTo(x + w, y).strokeColor('#D1D5DB').lineWidth(1).stroke();
    moveY(4);

    if (!svc.length) {
      doc.font('Helvetica').fontSize(7.8).fillColor(MUTED)
        .text('No monthly service lines were supplied. (Pass `itemsMonthly` + `minutesIncluded`.)', x, y, { width: w });
      moveY(10);
      return;
    }

    const rowH = 10;
    let subtotal = 0;
    for (const it of svc) {
      const lineTotal = (Number(it.unitPrice) || 0) * (Number(it.qty) || 0);
      subtotal += Number.isFinite(lineTotal) ? lineTotal : 0;

      doc.font('Helvetica').fontSize(7.8).fillColor(MUTED);
      doc.text(it.name || '', rx[0], y, { width: cW[0] });
      doc.text(String(it.qty || 0), rx[1], y, { width: cW[1], align: 'right' });
      doc.text(it.unitPrice > 0 ? money(it.unitPrice) : '—', rx[2], y, { width: cW[2], align: 'right' });
      doc.text(money(lineTotal), rx[3], y, { width: cW[3], align: 'right' });
      moveY(rowH);

      if (it.note) {
        doc.font('Helvetica-Oblique').fillColor(MUTED)
          .text(it.note, rx[0], y - 1, { width: cW[0], lineGap: 0.1 });
        moveY(6);
      }
    }

    const vat = subtotal * Number(vatRate || 0);
    const total = subtotal + vat;
    moveY(2);
    doc.moveTo(x, y).lineTo(x + w, y).strokeColor('#E5E7EB').lineWidth(1).stroke();
    moveY(3);

    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(`Monthly Subtotal (ex VAT): ${money(subtotal)}`, x, y); moveY(12);
    doc.text(`VAT (${Math.round(Number(vatRate||0)*100)}%): ${money(vat)}`, x, y); moveY(12);
    doc.font('Helvetica-Bold').fillColor(INK)
      .text(`Monthly Total (incl VAT): ${money(total)}`, x, y);
    moveY(20);
  });

  // ---- Support & Service Levels (table under services)
  drawCard('Support & Service Levels', ({ x, w }) => {
    const colW = [ w * 0.25, w * 0.35, w * 0.40 ];
    const rx = [ x, x + colW[0], x + colW[0] + colW[1] ];

    // Header row
    doc.save().rect(x, y, w, 14).fill(BG).restore();
    doc.font('Helvetica-Bold').fontSize(8).fillColor(INK);
    doc.text('Priority', rx[0], y + 3, { width: colW[0], align: 'center' });
    doc.text('Response Time', rx[1], y + 3, { width: colW[1], align: 'center' });
    doc.text('Restore Target', rx[2], y + 3, { width: colW[2], align: 'center' });
    moveY(14);
    doc.moveTo(x, y).lineTo(x + w, y).strokeColor(BORDER).stroke();

    const rows = [
      ['P1 Outage', '1 hour', '8 hours'],
      ['P2 Major fault', '4 hours', '1 business day'],
      ['P3/MAC', '1 business day', '2–3 business days']
    ];
    doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    for (const r of rows) {
      doc.text(r[0], rx[0], y + 3, { width: colW[0], align: 'center' });
      doc.text(r[1], rx[1], y + 3, { width: colW[1], align: 'center' });
      doc.text(r[2], rx[2], y + 3, { width: colW[2], align: 'center' });
      moveY(14);
      doc.moveTo(x, y).lineTo(x + w, y).strokeColor('#EEE').stroke();
    }

    moveY(12);
    doc.font('Helvetica').fontSize(8.2).fillColor(MUTED)
      .text(`Remote support: included (WhatsApp +27 68 351 0074)`, x, y, { width: w });
    moveY(12);
    doc.text(`On-site support: R450 per visit (travel/after-hours may apply)`, x, y, { width: w });
  });

  // Footer Page 1
  footer(1);

  // =========================
// PAGE 2 — Debit Order Mandate + T&Cs
// =========================
await newPageWithHeader('Debit Order Mandate', { align: 'left', subtitle: '' });

drawCard('Debit Order Mandate (Fill In)', (box) => {
  const labelW = 140;

  const fill = (label, preset = '', width = box.w - labelW - 22) => {
    if (!hasSpace(18)) return;
    const lx = box.x + labelW;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label, box.x, y + 2, { width: labelW - 10 });
    const ly = y + 11;
    doc.moveTo(lx, ly).lineTo(lx + width, ly).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
    if (preset) doc.font('Helvetica').fontSize(8).fillColor(INK)
      .text(String(preset), lx + 2, y + 3, { width: width - 4, ellipsis: true });
    moveY(16);
  };

  const fillTwoUp = (
    labelA, presetA = '', widthA = 120,
    labelB, presetB = '', widthB = 140,
    gap = 24
  ) => {
    if (!hasSpace(18)) return;
    const lxA = box.x + labelW;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(labelA, box.x, y + 2, { width: labelW - 10 });
    const ly = y + 11;
    doc.moveTo(lxA, ly).lineTo(lxA + widthA, ly).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
    if (presetA) doc.font('Helvetica').fontSize(8).fillColor(INK)
      .text(String(presetA), lxA + 2, y + 3, { width: widthA - 4, ellipsis: true });

    const xRight = lxA + widthA + gap;
    const labelW2 = 110;
    const lxB = xRight + labelW2;
    const maxWB = Math.max(40, Math.min(widthB, (box.x + box.w) - lxB - 4));
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(labelB, xRight, y + 2, { width: labelW2 - 10 });
    doc.moveTo(lxB, ly).lineTo(lxB + maxWB, ly).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
    if (presetB) doc.font('Helvetica').fontSize(8).fillColor(INK)
      .text(String(presetB), lxB + 2, y + 3, { width: maxWB - 4, ellipsis: true });

    moveY(16);
  };

  // Prefill rows
  fill('Account Holder', debitOrder?.accountName || '');
  fill('Bank', debitOrder?.bank || '');
  fill('Branch Code', debitOrder?.branchCode || '');
  fill('Account Number', debitOrder?.accountNumber || '');
  fill('Account Type (e.g., Cheque/Savings)', debitOrder?.accountType || '');

  fillTwoUp(
    'Collection Day (1–31)', debitOrder?.dayOfMonth != null ? `Day ${debitOrder.dayOfMonth}` : '', 120,
    'Mandate Date (YYYY-MM-DD)', debitOrder?.mandateDateISO || '', 140, 28
  );

  // Signature block + Date block
  if (hasSpace(60)) {
    const gap = 20;
    const sigW = Math.min((box.w * 0.68), box.w - 160 - gap);
    const dateW = Math.min(140, box.w - sigW - gap);

    const labelY = y + 2;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Customer Signature', box.x, labelY);

    const sigY = y + 18, sigH = 42;
    doc.save().roundedRect(box.x, sigY, sigW, sigH, 6).fill('#F5F6F7').restore();
    doc.roundedRect(box.x, sigY, sigW, sigH, 6).strokeColor('#E5E7EB').lineWidth(1).stroke();

    const dateX = box.x + sigW + gap;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Date', dateX, labelY);
    doc.save().roundedRect(dateX, sigY, dateW, sigH, 6).fill('#F9FAFB').restore();
    doc.roundedRect(dateX, sigY, dateW, sigH, 6).strokeColor('#E5E7EB').lineWidth(1).stroke();

    y = sigY + sigH + 8; doc.y = y;
  }
}, { minHeight: 140 });

// Debit Order Terms & Conditions (verbatim)
drawCard('Debit Order Terms & Conditions', ({ x, w }) => {
  const paras = [
    'This signed Authority and Mandate refers to our contract dated: (“the Agreement”).',
    '',
    'I / We hereby authorise you to issue and deliver payment instructions to your Banker for collection against my / our abovementioned account at my / Our above-mentioned Bank (or any other bank or branch to which I / we may transfer my / our account) on condition that the sum of such payment instructions will never exceed my / our obligations as agreed to in the Agreement and commencing on_________ and continuing until this Authority and Mandate is terminated by me / us by giving you notice in writing of not less than 20 ordinary working days, and sent by prepaid registered post or delivered to your address as indicated above.',
    '',
    'The individual payment instructions so authorised to be issued must be issued and delivered as follows: monthly. In the event that the payment day falls on a Sunday, or recognised South African public holiday, the payment day will automatically be the preceding ordinary business day. Payment Instructions due in December may be debited against my account on ____________',
    '',
    'I / We understand that the withdrawals hereby authorized will be processed through a computerized system provided by the South African Banks and I also understand that details of each withdrawal will be printed on my bank statement. Each transaction will contain a number, which must be included in the said payment instruction and if provided to you should enable you to identify the Agreement. A payment reference is added to this form before the issuing of any payment instruction.',
    '',
    'Mandate',
    'I / We acknowledge that all payment instructions issued by you shall be treated by my / our above-mentioned Bank as if the instructions have been issued by me/us personally.',
    '',
    'Cancellation',
    'I / We agree that although this Authority and Mandate may be cancelled by me / us, such cancellation will not cancel the Agreement. I / We shall not be entitled to any refund of amounts which you have withdrawn while this Authority was in force, if such amounts were legally owing to you.',
    '',
    'Assignment',
    'I / We acknowledge that this Authority may be ceded or assigned to a third party if the Agreement is also ceded or assigned to that third party, but in the absence of such assignment of the Agreement, this Authority and Mandate cannot be assigned to any third party.'
  ];

  const writePara = (txt, isHeading = false) => {
    if (!hasSpace(18)) return false;
    if (isHeading) {
      doc.font('Helvetica-Bold').fontSize(8.2).fillColor(INK)
        .text(txt, x, y, { width: w });
      moveY(8);
    } else {
      doc.font('Helvetica').fontSize(8).fillColor(MUTED)
        .text(txt, x, y, { width: w, lineGap: 1.2 });
      moveY(10);
    }
    return true;
  };

  for (const p of paras) {
    if (p === '') { moveY(6); continue; }
    const isHead = /^(Mandate|Cancellation|Assignment)$/.test(p.trim());
    if (!writePara(p, isHead)) break;
  }
}, { minHeight: 140 });

// Client initials bottom of page 2
{
  const initials2Y = pageBottom() - FOOTER_H - 8;
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Client Initials:', L, initials2Y, { width: 90 });
  doc.moveTo(L + 70, initials2Y + 10).lineTo(L + 170, initials2Y + 10).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
}

// Footer Page 2
footer(2);


// =========================
// PAGE 3 — General Terms & Conditions
// =========================
await newPageWithHeader('Terms & Conditions', { align: 'left', subtitle: '' });

// Two-column layout
const COL_GAP = 22;
const COL_W = (W - COL_GAP) / 2;
const colX = (i) => L + i * (COL_W + COL_GAP);
const colTop = y;
const colBottom = pageBottom() - FOOTER_H - 12;
let colYs = [colTop, colTop];

const tryWriteSection = (colIndex, title, bullets) => {
  let x = colX(colIndex);
  let yCursor = colYs[colIndex];

  const headerH = 16;
  const bulletsH = bullets.reduce((acc, t) => {
    const h = 12 + doc.heightOfString(String(t||''), { width: COL_W - 14, lineGap: 0.5 });
    return acc + h + 6;
  }, 0);

  const needed = headerH + bulletsH + 6;
  if (yCursor + needed > colBottom) return false;

  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(title, x, yCursor, { width: COL_W });
  doc.moveTo(x, doc.y + 2).lineTo(x + COL_W, doc.y + 2).strokeColor(BORDER).lineWidth(1).stroke();
  yCursor = doc.y + 8;

  for (const t of bullets) {
    const bx = x + 8;
    doc.circle(x + 2.5, yCursor + 3.2, 1.1).fill('#6B7280');
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.8)
       .text(t, bx, yCursor, { width: COL_W - 12, lineGap: 0.5 });
    yCursor = doc.y + 6;
    doc.fillColor(INK);
  }

  yCursor += 6;
  colYs[colIndex] = yCursor;
  return true;
};

const placeSection = (title, bullets) => {
  if (!tryWriteSection(0, title, bullets)) {
    if (!tryWriteSection(1, title, bullets)) return false;
  }
  return true;
};

// NOTE: "Support & Service Levels" REMOVED (now on Page 1)
const sections = [
  {
    title: 'Fees, Billing & Payments',
    bullets: [
      'First invoice is payable upfront before activation. Thereafter billing occurs monthly in arrears (end of month).',
      'Payment must be made by debit order or EFT on or before the due date; late payments may result in service suspension.',
      'Interest on overdue amounts will accrue at prime + 6%.',
      'Prices exclude VAT unless otherwise stated.',
      'Usage/call charges are billed in arrears. Calls over and above the included monthly minutes are billed at 35c per local minute and 55c per mobile minute.',
      'The Service Order reflects fixed monthly services only and excludes any additional call usage.'
    ]
  },
  {
    title: 'Customer Responsibilities',
    bullets: [
      'Provide stable power, Internet, and site access for installation/support.',
      'Maintain LAN/Wi-Fi security; prevent misuse or fraud.',
      'Use equipment/services lawfully; comply with POPIA for call recording and notices to employees/customers.',
      'Remain liable for all charges incurred on the account, whether authorised or unauthorised.',
      'Implement QoS/backup power for critical operations (recommended).'
    ]
  },
  {
    title: 'Equipment, Porting & Warranty',
    bullets: [
      'Hardware sold once-off; ownership passes to Customer upon payment.',
      'Manufacturer warranties (typically 12 months, return-to-base) apply; excludes surges/liquids/abuse/unauthorised firmware.',
      'Loan devices may be offered at VoIP Shop’s discretion and current pricing.',
      'Number porting timelines subject to donor carrier processes; RICA requirements apply.'
    ]
  },
  {
    title: 'Data Protection (POPIA)',
    bullets: [
      'Both parties shall process personal information in compliance with POPIA.',
      'Where call recording is enabled, Customer must ensure lawful basis, appropriate notices to staff/callers, and retention/deletion policies.',
      'Customer is responsible for limiting access to recordings and ensuring secure storage of exported data.',
      'Any suspected breach must be reported without undue delay and cooperatively mitigated.'
    ]
  },
  {
    title: 'Service Limitations & Exclusions',
    bullets: [
      'Quality of service may be affected by Customer LAN/Wi-Fi, power, third-party ISP/carriers, or environmental factors outside VoIP Shop’s control.',
      'SLA does not cover force majeure events (e.g., load-shedding, strikes, disasters) or faults within third-party networks.',
      'Moves/Adds/Changes outside standard scope may be chargeable and are handled as P3 tickets.',
      'Hardware damage from surges/liquids/abuse and unauthorised firmware changes are excluded from warranty.'
    ]
  },
  {
    title: 'Security, Fair Use & Recording',
    bullets: [
      'Customer must safeguard credentials and endpoints; unusual usage may trigger proactive suspensions.',
      'Fair use applies to minutes and inclusive features to prevent abuse and protect network integrity.',
      'If call recording is enabled, Customer is responsible for obtaining all required consents and retention policies (POPIA).',
      'VoIP Shop may implement fraud controls and routing changes without notice to mitigate risk.'
    ]
  },
  {
    title: 'Maintenance, Changes & Escalations',
    bullets: [
      'Planned maintenance will be scheduled outside business hours where possible; emergency maintenance may occur at short notice.',
      'Configuration change requests (MACs) are handled as P3 tickets with 2–3 business day targets.',
      'Escalation path available on request; critical incidents prioritised based on impact.'
    ]
  },
  {
    title: 'Liability, Suspension & Termination',
    bullets: [
      'No liability for indirect, consequential, or special damages, including loss of profit or business.',
      'Liability cap: the lesser of 3 months’ service fees or R100,000.',
      `Month-to-month; either party may cancel on ${noticeDays} days’ written notice.`,
      'Non-payment may lead to suspension until all arrears are settled; upon termination, unpaid fees are immediately due.'
    ]
  },
  {
    title: 'General',
    bullets: [
      'This SLA forms part of the overall agreement (signed quotes/orders/policies). If conflicts arise, the latest signed quote/order prevails for pricing/line items.',
      'Changes to this SLA require written agreement by both parties.',
      'Governing law: South Africa; venue: Johannesburg.',
      'If any clause is unenforceable, the remainder remains in force.'
    ]
  }
];

for (const sec of sections) {
  const ok = placeSection(sec.title, sec.bullets);
  if (!ok) break;
}

// Column divider (visual)
doc.save();
const midX = (L + COL_W) + (COL_GAP / 2);
doc.moveTo(midX, colTop - 4).lineTo(midX, colBottom + 4).strokeColor('#F0F0F0').lineWidth(1).stroke();
doc.restore();

// Client initials bottom of page 3
{
  const initials3Y = pageBottom() - FOOTER_H - 8;
  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
    .text('Client Initials:', L, initials3Y, { width: 90 });
  doc.moveTo(L + 70, initials3Y + 10).lineTo(L + 170, initials3Y + 10).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
}

// Footer Page 3
footer(3);
