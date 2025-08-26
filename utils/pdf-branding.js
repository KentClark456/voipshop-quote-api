// utils/pdf-branding.js
export async function drawLogoHeader(
  doc,
  {
    logoUrl,
    align = 'right',
    maxWidth = 140,
    maxHeight = 40,
    padX = 24,
    padY = 20,
    title = '',
    subtitle = ''
  } = {}
) {
  const W = doc.page.width;

  let x;
  if (align === 'left') x = padX;
  else if (align === 'center') x = (W - maxWidth) / 2;
  else x = W - padX - maxWidth; // right

  let drewLogo = false;
  if (logoUrl) {
    try {
      const res = await fetch(logoUrl);
      const ab = await res.arrayBuffer();
      const buf = Buffer.from(ab);
      doc.image(buf, x, padY, { fit: [maxWidth, maxHeight] });
      drewLogo = true;
    } catch {
      // ignore; fall back to text-only header
    }
  }

  const textX = align === 'left' ? x + (drewLogo ? maxWidth + 8 : 0) : padX;
  const textWidth = align === 'left' ? W - textX - padX : W - padX * 2;

  if (title || subtitle) {
    const titleY = drewLogo ? padY + 2 : padY;
    if (title) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827')
         .text(title, textX, titleY, { width: textWidth, align: align === 'center' ? 'center' : 'left' });
    }
    if (subtitle) {
      doc.font('Helvetica').fontSize(9).fillColor('#6B7280')
         .text(subtitle, textX, doc.y + 2, { width: textWidth, align: align === 'center' ? 'center' : 'left' });
    }
  }

  const headerBottom = Math.max(padY + (drewLogo ? maxHeight : 0), doc.y);
  return Math.round(headerBottom + 18);
}
