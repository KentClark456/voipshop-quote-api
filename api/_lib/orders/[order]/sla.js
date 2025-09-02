// /api/orders/[order]/sla.js
export const config = { runtime: 'nodejs' };

import { getOrderLinks, getOrderSnapshot, asPdfResponse } from '../../_lib/order-storage.js';

export default async function handler(req, res) {
  try {
    const order = req.query.order;
    if (!order) return res.status(400).json({ error: 'order required' });

    const links = await getOrderLinks(order);
    if (links?.slaUrl) {
      res.writeHead(302, { Location: links.slaUrl });
      return res.end();
    }

    const snap = await getOrderSnapshot(order);
    const { buildSlaPdfBuffer } = await import('../../services/buildSlaPdfBuffer.js');
    const buf = await buildSlaPdfBuffer(snap);
    return asPdfResponse(res, buf, `SLA-${snap.invoiceNumber || order}.pdf`, true);
  } catch (e) {
    console.error('[orders/sla]', e);
    return res.status(404).json({ error: e.message || 'SLA not available' });
  }
}
