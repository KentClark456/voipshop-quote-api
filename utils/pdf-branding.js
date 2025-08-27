// utils/pdf-branding.js (excerpt)
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';

async function readFileToBuffer(p) {
  try { const b = await fs.readFile(p); return b?.length ? b : null; } catch { return null; }
}
function fetchHttpsToBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function loadLogoBuffer({ logoUrl, localLogoHints = [] } = {}) {
  // 1) Try hints (absolute/local paths)
  for (const hint of localLogoHints) {
    if (hint && path.isAbsolute(hint)) {
      const buf = await readFileToBuffer(hint);
      if (buf) return buf;
    }
  }

  // 2) Try logoUrl
  if (logoUrl) {
    // file://
    if (logoUrl.startsWith('file://')) {
      // handle spaces and parentheses automatically
      const p = logoUrl.replace(/^file:\/\//, '');
      const buf = await readFileToBuffer(p);
      if (buf) return buf;
    }
    // absolute path
    if (path.isAbsolute(logoUrl)) {
      const buf = await readFileToBuffer(logoUrl);
      if (buf) return buf;
    }
    // https
    if (/^https?:\/\//i.test(logoUrl)) {
      try { const buf = await fetchHttpsToBuffer(logoUrl); if (buf?.length) return buf; } catch {}
    }
    // data URL
    if (logoUrl.startsWith('data:image/')) {
      const m = logoUrl.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
      if (m) return Buffer.from(m[2], 'base64');
    }
  }

  return null;
}

export async function drawLogoHeader(doc, {
  logoUrl,
  localLogoHints = [],
  align = 'left',
  title = '',
  subtitle = '',
  maxLogoWidth = 130,
  top = 18
} = {}) {
  const L = doc.page.margins.left;
  const R = doc.page.width - doc.page.margins.right;
  const W = R - L;

  const logoBuf = await loadLogoBuffer({ logoUrl, localLogoHints });
  if (logoBuf) {
    const x = align === 'right' ? (R - maxLogoWidth) : L;
    try { doc.image(logoBuf, x, top, { width: maxLogoWidth }); } catch (e) { /* fallback below */ }
  }

  // Title/subtitle block on the opposite side if needed; if you already
  // center these elsewhere, keep your existing behavior.
  if (title) {
    doc.font('Helvetica-Bold').fontSize(18)
      .text(title, L, top, { width: W, align: align === 'right' ? 'left' : 'right' });
  }
  if (subtitle) {
    doc.moveDown(0.1);
    doc.font('Helvetica').fontSize(9)
      .text(subtitle, L, undefined, { width: W, align: align === 'right' ? 'left' : 'right' });
  }

  return Math.max(doc.y, top + 40); // cursor height back to caller
}
