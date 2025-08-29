// /api/_lib/persist-order-artifacts.js
import { put } from '@vercel/blob';

/** Trim to safe path segments: letters, numbers, underscore, hyphen */
function safePart(s) {
  return String(s || '')
    .trim()
    .replace(/[^\w\-]+/g, '-')   // keep [A-Za-z0-9_-]
    .replace(/-{2,}/g, '-')      // collapse -- to -
    .replace(/^-+|-+$/g, '');    // trim leading/trailing -
}

/** Normalize any buffer-ish value to a Uint8Array (or null) */
function asBytes(b) {
  if (!b) return null;
  if (b instanceof Uint8Array) return b;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(b)) return new Uint8Array(b);
  return null;
}

/** Build a public URL on a known base if provided via env */
function coercePublicUrl({ url, pathname }) {
  const base = (process.env.BLOB_BASE_URL || '').trim().replace(/\/+$/,'');
  if (!base || !pathname) return url; // SDK already returns a public URL
  const path = String(pathname).replace(/^\/+/, '');
  return `${base}/${path}`;
}

/**
 * Saves PDFs and a snapshot to Vercel Blob at:
 *   orders/{orderNumber}/[invoice-*.pdf|sla-*.pdf|porting-*.pdf|quote-*.pdf|meta.json|links.json]
 * Returns { invoiceUrl?, slaUrl?, portingUrl?, quoteUrl?, metaUrl, orderNumber, invoiceNumber?, quoteNumber? }
 */
export async function persistOrderArtifacts({
  orderNumber,
  invoiceNumber,      // optional (used in filenames)
  quoteNumber,        // optional
  invoicePdfBuffer,   // Buffer | Uint8Array | null
  quotePdfBuffer,     // Buffer | Uint8Array | null
  slaPdfBuffer,       // Buffer | Uint8Array | null
  portingPdfBuffer,   // Buffer | Uint8Array | null
  snapshot = {}       // arbitrary JSON snapshot of what created the PDFs
}) {
  if (!orderNumber) throw new Error('orderNumber is required');

  const orderSafe = safePart(orderNumber);
  const invSafe   = safePart(invoiceNumber);
  const quoteSafe = safePart(quoteNumber);

  const base = `orders/${orderSafe}`;
  const uploads = [];

  // --- 1) Snapshot (meta.json)
  uploads.push(
    put(`${base}/meta.json`, JSON.stringify(snapshot, null, 2), {
      access: 'public',
      contentType: 'application/json',
      cacheControl: 'public, max-age=31536000',
      addRandomSuffix: false
    })
  );

  // --- 2) PDFs (only upload the ones we got)
  const HEADERS = {
    access: 'public',
    contentType: 'application/pdf',
    cacheControl: 'public, max-age=31536000, immutable',
    addRandomSuffix: false
  };

  const quoteBytes   = asBytes(quotePdfBuffer);
  const invoiceBytes = asBytes(invoicePdfBuffer);
  const slaBytes     = asBytes(slaPdfBuffer);
  const portingBytes = asBytes(portingPdfBuffer);

  if (quoteBytes) {
    uploads.push(put(`${base}/quote-${quoteSafe || orderSafe}.pdf`, quoteBytes, HEADERS));
  }
  if (invoiceBytes) {
    uploads.push(put(`${base}/invoice-${invSafe || orderSafe}.pdf`, invoiceBytes, HEADERS));
  }
  if (slaBytes) {
    uploads.push(put(`${base}/sla-${invSafe || orderSafe}.pdf`, slaBytes, HEADERS));
  }
  if (portingBytes) {
    uploads.push(put(`${base}/porting-${orderSafe}.pdf`, portingBytes, HEADERS));
  }

  const results = await Promise.all(uploads);

  // --- 3) Build links object from results
  const links = {
    orderNumber: orderSafe,
    invoiceNumber: invSafe || undefined,
    quoteNumber: quoteSafe || undefined
  };

  for (const r of results) {
    if (!r?.url) continue;
    const publicUrl = coercePublicUrl(r); // respect BLOB_BASE_URL if present
    if (r.pathname?.endsWith('/meta.json')) links.metaUrl = publicUrl;
    if (r.pathname?.endsWith('.pdf')) {
      const p = r.pathname;
      if (p.includes('/quote-'))   links.quoteUrl   = publicUrl;
      if (p.includes('/invoice-')) links.invoiceUrl = publicUrl;
      if (p.includes('/sla-'))     links.slaUrl     = publicUrl;
      if (p.includes('/porting-')) links.portingUrl = publicUrl;
    }
  }

  // --- 4) Persist links.json (handy for server-side lookups)
  await put(`${base}/links.json`, JSON.stringify(links, null, 2), {
    access: 'public',
    contentType: 'application/json',
    cacheControl: 'public, max-age=31536000',
    addRandomSuffix: false
  });

  return links;
}
