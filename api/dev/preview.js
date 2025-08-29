// api/dev/preview.js
import { buildSlaPdfBuffer } from '../services/buildSlaPdfBuffer.js';

export default async function handler(req, res) {
  try {
    const { type = 'sla' } = req.query;

    if (type === 'sla') {
      const buf = await buildSlaPdfBuffer({
        company: { name: 'VoIP Shop', email: 'sales@voipshop.co.za' },
        customer: { name: 'Preview Customer', email: 'preview@example.com' },
        itemsMonthly: [
          { name: 'Cloud PBX Platform', qty: 1, unit: 150 },
          { name: 'Extension Fee', qty: 5, unit: 65 },
          { name: 'Calls (bundles)', qty: 1, unit: 100, minutes: 250 }
        ],
        minutesIncluded: 250
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="sla-preview.pdf"');
      return res.send(buf);
    }

    // (Optional) Add other types later without new files:
    // if (type === 'invoice') { ... }
    // if (type === 'porting') { ... }

    return res.status(400).json({ ok: false, error: 'Unknown preview type' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
}
