// /api/orders/[order]/invoice.js
export const config = { runtime: 'nodejs' };

import { getOrderLinks, getOrderSnapshot, asPdfResponse } from '../../_lib/order-storage.js';

export default async function handler(req, res) {
  try {
    const order = req.query.order;
    if (!order) return res.status(400).json({ error: 'order required' });

    const links = await getOrderLinks(order);
    if (links?.invoiceUrl) {
      res.writeHead(302, { Location: links.invoiceUrl });
      return res.end();
    }

    const snap = await getOrderSnapshot(order);
    const { buildInvoicePdfBuffer } = await import('../../services/buildInvoicePdfBuffer.js');
    const buf = await buildInvoicePdfBuffer(snap);
    return asPdfResponse(res, buf, `Invoice-${snap.invoiceNumber || order}.pdf`, true);
  } catch (e) {
    console.error('[orders/invoice]', e);
    return res.status(404).json({ error: e.message || 'Invoice not available' });
  }
}
