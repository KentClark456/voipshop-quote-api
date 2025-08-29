// /api/dev/preview-sla.js
// Adjust this import to your actual builder path:
import { buildSlaPdfBuffer } from '../services/buildSlaPdfBuffer.js';

export default async function handler(req, res) {
  try {
    const isJson = (req.headers['content-type'] || '').includes('application/json');
    const body = isJson ? await readJson(req) : null;

    const url = new URL(req.url, `http://${req.headers.host}`);
    const download = url.searchParams.get('download') === '1';
    const orderNumber = url.searchParams.get('order') || body?.orderNumber || 'VS-PREVIEW-SLA';
    const email = url.searchParams.get('email') || body?.customer?.email || 'test@example.com';
    const minutes = Number(url.searchParams.get('minutes') || body?.minutesIncluded || 250);

    const basePayload = {
      orderNumber,
      company: { name: 'VoIP Shop' },
      customer: { name: 'Test Customer', email },
      itemsMonthly: [
        { name: 'Cloud PBX Platform', qty: 1, unit: 150 },
        { name: 'Extension Fee', qty: 3, unit: 65 },
      ],
      minutesIncluded: minutes,
      notes: 'Preview SLA for layout testing.'
    };

    const payload = deepMerge(basePayload, body || {});
    const pdf = await buildSlaPdfBuffer(payload);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="sla-${safe(orderNumber)}.pdf"`
    );
    res.send(pdf);
  } catch (err) {
    console.error('[preview-sla] error:', err);
    res.status(500).send(err?.message || 'Error generating SLA preview');
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
