// /api/orders/[order]/porting.js
export const config = { runtime: 'nodejs' };

import { getOrderLinks, getOrderSnapshot, asPdfResponse } from '../../_lib/order-storage.js';

export default async function handler(req, res) {
  try {
    const order = req.query.order;
    if (!order) return res.status(400).json({ error: 'order required' });

    const links = await getOrderLinks(order);
    if (links?.portingUrl) {
      res.writeHead(302, { Location: links.portingUrl });
      return res.end();
    }

    const snap = await getOrderSnapshot(order);
    const { buildPortingPdfBuffer } = await import('../../services/buildPortingPdfBuffer.js');
    const buf = await buildPortingPdfBuffer(snap);
    return asPdfResponse(res, buf, `Porting-${order}.pdf`, true);
  } catch (e) {
    console.error('[orders/porting]', e);
    return res.status(404).json({ error: e.message || 'Porting doc not available' });
  }
}
