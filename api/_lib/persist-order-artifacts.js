// api/_lib/persist-order-artifacts.js
import { put } from '@vercel/blob';

function safePart(s) {
  return String(s || '')
    .trim()
    .replace(/[^\w\-]+/g, '-')       // letters, numbers, underscore, hyphen
    .replace(/-{2,}/g, '-')          // collapse multiple dashes
    .replace(/^-+|-+$/g, '');        // trim leading/trailing dashes
}

/**
 * Saves PDFs and a snapshot to Vercel Blob under orders/{orderNumber}/...
 * Returns public URLs you can use on the client.
 */
export async function persistOrderArtifacts({
  orderNumber,
  invoiceNumber,      // optional (used in filenames)
  quoteNumber,        // optional
  invoicePdfBuffer,   // Buffer | Uint8Array | null
  quotePdfBuffer,     // Buffer | Uint8Array | null
  slaPdfBuffer,       // Buffer | Uint8Array | null
  portingPdfBuffer,   // Buffer | Uint8Array | null
  snapshot = {}
}) {
  if (!orderNumber) throw new Error('orderNumber is required');

  const orderSafe = safePart(orderNumber);
  const invSafe   = safePart(invoiceNumber);
  const quoteSafe = safePart(quoteNumber);

  const base = `orders/${orderSafe}`;
  const uploads = [];

  // 1) Snapshot
  uploads.push(
    put(`${base}/meta.json`, JSON.stringify(snapshot, null, 2), {
      access: 'public',
      contentType: 'application/json',
      cacheControl: 'public, max-age=31536000',
      addRandomSuffix: false
    })
  );

  // 2) PDFs
  const HEADERS = {
    access: 'public',
    contentType: 'application/pdf',
    cacheControl: 'public, max-age=31536000, immutable',
    addRandomSuffix: false
  };

  if (quotePdfBuffer) {
    uploads.push(put(
      `${base}/quote-${quoteSafe || orderSafe}.pdf`,
      quotePdfBuffer,
      HEADERS
    ));
  }
  if (invoicePdfBuffer) {
    uploads.push(put(
      `${base}/invoice-${invSafe || orderSafe}.pdf`,
      invoicePdfBuffer,
      HEADERS
    ));
  }
  if (slaPdfBuffer) {
    uploads.push(put(
      `${base}/sla-${invSafe || orderSafe}.pdf`,
      slaPdfBuffer,
      HEADERS
    ));
  }
  if (portingPdfBuffer) {
    uploads.push(put(
      `${base}/porting-${orderSafe}.pdf`,
      portingPdfBuffer,
      HEADERS
    ));
  }

  const results = await Promise.all(uploads);

  // 3) Build links object
  const links = { orderNumber: orderSafe, invoiceNumber: invSafe || undefined, quoteNumber: quoteSafe || undefined };

  for (const r of results) {
    if (!r?.url) continue;
    if (r.pathname.endsWith('.pdf')) {
      if (r.pathname.includes('/quote-'))   links.quoteUrl   = r.url;
      if (r.pathname.includes('/invoice-')) links.invoiceUrl = r.url;
      if (r.pathname.includes('/sla-'))     links.slaUrl     = r.url;
      if (r.pathname.includes('/porting-')) links.portingUrl = r.url;
    } else if (r.pathname.endsWith('/meta.json')) {
      links.metaUrl = r.url;
    }
  }

  // 4) Write links.json
  await put(`${base}/links.json`, JSON.stringify(links, null, 2), {
    access: 'public',
    contentType: 'application/json',
    cacheControl: 'public, max-age=31536000',
    addRandomSuffix: false
  });

  return links;
}

