// api/_lib/persist-order-artifacts.js
import { put } from '@vercel/blob';

/**
 * Saves PDFs and a snapshot to Vercel Blob under orders/{orderNumber}/...
 * Returns public URLs you can use on the client.
 *
 * Any of the buffers can be null/undefined if not applicable for that request.
 */
export async function persistOrderArtifacts({
  orderNumber,
  invoiceNumber,      // optional (used in filenames)
  quoteNumber,        // optional
  invoicePdfBuffer,   // Buffer | Uint8Array | null
  quotePdfBuffer,     // Buffer | Uint8Array | null
  slaPdfBuffer,       // Buffer | Uint8Array | null
  portingPdfBuffer,   // Buffer | Uint8Array | null
  snapshot = {}       // the exact inputs used to build the PDFs
}) {
  if (!orderNumber) throw new Error('orderNumber is required');

  const base = `orders/${orderNumber}`;
  const uploads = [];

  // Save snapshot (used later for rebuild fallback)
  uploads.push(
    put(`${base}/meta.json`, JSON.stringify(snapshot, null, 2), {
      access: 'public',
      contentType: 'application/json',
      cacheControl: 'public, max-age=31536000'
    })
  );

  // Upload whichever PDFs you have in this request
  const HEADERS = {
    access: 'public',
    contentType: 'application/pdf',
    cacheControl: 'public, max-age=31536000, immutable'
  };

  if (quotePdfBuffer) {
    uploads.push(put(
      `${base}/quote-${quoteNumber || orderNumber}.pdf`,
      quotePdfBuffer,
      HEADERS
    ));
  }
  if (invoicePdfBuffer) {
    uploads.push(put(
      `${base}/invoice-${invoiceNumber || orderNumber}.pdf`,
      invoicePdfBuffer,
      HEADERS
    ));
  }
  if (slaPdfBuffer) {
    uploads.push(put(
      `${base}/sla-${invoiceNumber || orderNumber}.pdf`,
      slaPdfBuffer,
      HEADERS
    ));
  }
  if (portingPdfBuffer) {
    uploads.push(put(
      `${base}/porting-${orderNumber}.pdf`,
      portingPdfBuffer,
      HEADERS
    ));
  }

  const results = await Promise.all(uploads);

  // Build a links object (readable later by redirect routes or your UI)
  const links = { orderNumber, invoiceNumber, quoteNumber };

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

  // Save a links.json for easy server-side lookup later
  await put(`${base}/links.json`, JSON.stringify(links, null, 2), {
    access: 'public',
    contentType: 'application/json',
    cacheControl: 'public, max-age=31536000'
  });

  return links;
}
