// /api/orders/[order]/quote.js
export const config = { runtime: 'nodejs' };

import { getOrderLinks, getOrderSnapshot, asPdfResponse } from '../../_lib/order-storage.js';

export default async function handler(req, res) {
  try {
    const order = req.query.order;
    if (!order) return res.status(400).json({ error: 'order required' });

    // 1) If a persisted Blob link exists, redirect to it
    const links = await getOrderLinks(order);
    if (links?.quoteUrl) {
      res.writeHead(302, { Location: links.quoteUrl });
      return res.end();
    }

    // 2) Fallback: rebuild from snapshot
    const snap = await getOrderSnapshot(order);
    const { buildQuotePdfBuffer } = await import('../../services/buildQuotePdfBuffer.js');
    const buf = await buildQuotePdfBuffer(snap);
    return asPdfResponse(res, buf, `Quote-${snap.quoteNumber || order}.pdf`, true);
  } catch (e) {
    console.error('[orders/quote]', e);
    return res.status(404).json({ error: e.message || 'Quote not available' });
  }
}
