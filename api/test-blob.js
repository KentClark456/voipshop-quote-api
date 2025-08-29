// /api/test-blob.js
import { put } from '@vercel/blob';

export const config = {
  runtime: 'nodejs',
};

export default async function handler(req, res) {
  try {
    // Example: order VS-TEST-123
    const orderNumber = 'VS-TEST-123';

    // Write a small text blob
    const { url } = await put(
      `orders/${orderNumber}/hello.txt`, // path inside your blob store
      'Hello from VoIP Shop Blob test!', // file contents
      { access: 'public' }               // make it accessible
    );

    return res.status(200).json({
      ok: true,
      url,
    });
  } catch (err) {
    console.error('Blob write failed:', err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
