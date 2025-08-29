// /api/dev/preview-invoice.js
// Adjust this import to your actual builder path:
import { buildInvoicePdfBuffer } from '../services/buildInvoicePdfBuffer.js';

export default async function handler(req, res) {
  try {
    // Allow GET (quick preview) and POST (custom JSON payload while testing)
    const isJson = (req.headers['content-type'] || '').includes('application/json');
    const body = isJson ? await readJson(req) : null;

    const url = new URL(req.url, `http://${req.headers.host}`);
    const download = url.searchParams.get('download') === '1';
    const orderNumber = url.searchParams.get('order') || body?.orderNumber || 'VS-PREVIEW-INV';
    const email = url.searchParams.get('email') || body?.customer?.email || 'test@example.com';

    // Minimal sensible defaults; merge any POSTed values over these
    const basePayload = {
      orderNumber,
      dateISO: new Date().toISOString(),
      company: { name: 'VoIP Shop', vat: '1234567890' },
      customer: { name: 'Test Customer', email },
      itemsOnceOff: [
        { name: 'Yealink T31P', qty: 2, unit: 1100 },
        { name: 'Installation', qty: 1, unit: 0 },
      ],
      itemsMonthly: [
        { name: 'Cloud PBX Platform', qty: 1, unit: 150 },
        { name: 'Extension Fee', qty: 3, unit: 65 },
        { name: 'Calls (250-min bundle)', qty: 1, unit: 100 },
      ],
      subtotals: { onceOff: 2200, monthly: 445 }, // purely for your layout if you show totals
      notes: 'Preview invoice for layout testing.'
    };

    const payload = deepMerge(basePayload, body || {});
    const pdf = await buildInvoicePdfBuffer(payload);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="invoice-${safe(orderNumber)}.pdf"`
    );
    res.send(pdf);
  } catch (err) {
    console.error('[preview-invoice] error:', err);
    res.status(500).send(err?.message || 'Error generating invoice preview');
  }
}

function safe(s) { return String(s || '').replace(/[^\w.-]+/g, '-'); }
function deepMerge(a,b){
  if (!b || typeof b!=='object') return a;
  const out = Array.isArray(a) ? [...a] : { ...a };
  for (const k of Object.keys(b)) {
    const v = b[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && a && typeof a[k] === 'object') {
      out[k] = deepMerge(a[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
function readJson(req){
  return new Promise((resolve,reject)=>{
    let d=''; req.on('data',c=>d+=c);
    req.on('end',()=>{ try{ resolve(d?JSON.parse(d):null);}catch(e){reject(e);} });
    req.on('error',reject);
  });
}
