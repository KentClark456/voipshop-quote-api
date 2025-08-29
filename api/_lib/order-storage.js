// /api/_lib/order-storage.js
// Helper to fetch links.json and meta.json from Blob storage
// You MUST set BLOB_BASE_URL in your env, e.g.:
// BLOB_BASE_URL = https://<your>.public.blob.vercel-storage.com

const BASE = (process.env.BLOB_BASE_URL || '').replace(/\/+$/, '');

function blobUrl(path) {
  if (!BASE) throw new Error('Missing BLOB_BASE_URL env');
  // path like: orders/VS-000123/links.json
  return `${BASE}/${path.replace(/^\/+/, '')}`;
}

export async function getOrderLinks(order) {
  const url = blobUrl(`orders/${encodeURIComponent(order)}/links.json`);
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) return {};
  return r.json();
}

export async function getOrderSnapshot(order) {
  const url = blobUrl(`orders/${encodeURIComponent(order)}/meta.json`);
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('Snapshot not found');
  return r.json();
}

// tiny convenience for API handlers
export function asPdfResponse(res, buffer, filename, inline = true) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${filename}"`);
  res.status(200).send(buffer);
}
