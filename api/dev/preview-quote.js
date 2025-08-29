// /api/dev/preview-quote.js
// Adjust this import to your actual builder path:
import { buildQuotePdfBuffer } from '../services/buildQuotePdfBuffer.js';

export default async function handler(req, res) {
  try {
    const isJson = (req.headers['content-type'] || '').includes('application/json');
    const body = isJson ? await readJson(req) : null;

    const url = new URL(req.url, `http://${req.headers.host}`);
    const download = url.searchParams.get('download') === '1';
    const quoteNumber = url.searchParams.get('quote') || body?.quoteNumber || 'VOIP-PREVIEW-QUOTE';
    const email = url.searchParams.get('email') || body?.client?.email || 'test@example.com';

    const basePayload = {
      quoteNumber,
      dateISO: new Date().toISOString(),
      client: { name: 'Test Customer', email },
      itemsOnceOff: [
        { name: 'Yealink T33G', qty: 2, unit: 1450 },
        { name: 'Installation', qty: 1, unit: 0 },
      ],
      itemsMonthly: [
        { name: 'Cloud PBX Platform', qty: 1, unit: 150 },
        { name: 'Extension Fee', qty: 4, unit: 65 },
        { name: 'Calls (250-min bundle)', qty: 2, unit: 100 },
      ],
      subtotals: { onceOff: 2900, monthly: 480 },
      notes: 'Preview quote for layout testing.'
    };

    const payload = deepMerge(basePayload, body || {});
    const pdf = await buildQuotePdfBuffer(payload);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="quote-${safe(quoteNumber)}.pdf"`
    );
    res.send(pdf);
  } catch (err) {
    console.error('[preview-quote] error:', err);
    res.status(500).send(err?.message || 'Error generating quote preview');
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
