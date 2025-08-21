// api/send-quote.js
import { Resend } from 'resend';

// Primary (Lambda-friendly)
import chromium from '@sparticuz/chromium';
import pptrCore from 'puppeteer-core';

// Optional fallback (bundled Chromium). Will be dynamically imported only if needed.
// import puppeteer from 'puppeteer'; <-- we import this lazily below

// ---- Serverless-friendly defaults (safe even outside Lambda) ----
chromium.setHeadlessMode = true;
chromium.setGraphicsMode = false;

const resend = new Resend(process.env.RESEND_API_KEY);

// ---- Company defaults (override via payload.company) ----
const COMPANY_DEFAULTS = {
  name: 'VoIP Shop',
  legal: '',
  reg: '',
  address: '23 Lombardy Road, Broadacres, Johannesburg',
  phone: '+27 68 351 0074',
  email: 'sales@voipshop.co.za',
  vatRate: 0.15,
  validityDays: 7,
  logoUrl: 'https://voipshop.co.za/Assets/Group%201642logo%20(1).png'
};

// ---------- tiny utils ----------
const zar = (n) =>
  'R ' + Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function withDefaults(input = {}) {
  const company = { ...COMPANY_DEFAULTS, ...(input.company || {}) };
  return {
    quoteNumber: input.quoteNumber || 'Q-' + Date.now(),
    dateISO: input.dateISO || new Date().toISOString(),
    client: { ...(input.client || {}) },
    itemsOnceOff: Array.isArray(input.itemsOnceOff) ? input.itemsOnceOff : [],
    itemsMonthly: Array.isArray(input.itemsMonthly) ? input.itemsMonthly : [],
    subtotals: {
      onceOff: Number(input?.subtotals?.onceOff || 0),
      monthly: Number(input?.subtotals?.monthly || 0)
    },
    notes: input.notes || '',
    company
  };
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function escapeAttr(s = '') {
  return String(s).replace(/"/g, '&quot;');
}

// ---------- HTML template ----------
function renderQuoteHTML(q) {
  const d = new Date(q.dateISO);
  const dateStr = d.toISOString().slice(0, 10);
  const validStr = new Date(d.getTime() + (q.company.validityDays || 7) * 86400000).toISOString().slice(0, 10);

  const monthlyRows = q.itemsMonthly.map((it) => `
    <tr>
      <td class="p-3 text-gray-700">${escapeHtml(it.name || '')}</td>
      <td class="p-3 text-right text-gray-600">${Number(it.qty || 1)}</td>
      <td class="p-3 text-right font-medium text-gray-900">${zar(it.total || 0)}</td>
    </tr>`).join('');

  const onceRows = q.itemsOnceOff.map((it) => `
    <tr>
      <td class="p-3 text-gray-700">${escapeHtml(it.name || '')}</td>
      <td class="p-3 text-right text-gray-600">${Number(it.qty || 1)}</td>
      <td class="p-3 text-right font-medium text-gray-900">${zar(it.total || 0)}</td>
    </tr>`).join('');

  const vatRate = Number(q.company.vatRate ?? 0.15);
  const vatMonthly = (q.subtotals.monthly || 0) * vatRate;
  const vatOnce = (q.subtotals.onceOff || 0) * vatRate;

  const totalMonthly = (q.subtotals.monthly || 0) + vatMonthly;
  const totalOnce = (q.subtotals.onceOff || 0) + vatOnce;
  const grandPayNow = totalOnce + totalMonthly;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Quote | ${escapeHtml(q.company.name)}</title>
<link rel="icon" type="image/png" href="${escapeAttr(q.company.logoUrl)}"/>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  body{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @media print{ .no-print{display:none!important} body{background:#fff!important} .card{box-shadow:none!important} }
</style>
</head>
<body class="bg-[#F5F5F7] text-gray-900">
  <div class="no-print sticky top-0 z-10 bg-[#F5F5F7]/80 backdrop-blur">
    <div class="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-end gap-3">
      <a href="mailto:${escapeAttr(q.company.email)}" class="inline-flex items-center rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50">
        Accept Quote
      </a>
      <button onclick="window.print()" class="inline-flex items-center rounded-full bg-[#0071E3] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0066CC]">
        Print / Save PDF
      </button>
    </div>
  </div>

  <main class="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
    <header class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
      <div class="flex items-center gap-3">
        <img src="${escapeAttr(q.company.logoUrl)}" alt="${escapeAttr(q.company.name)}" class="h-10 w-auto object-contain">
        <div class="text-sm text-gray-500 leading-5">
          <div class="font-medium text-gray-900">${escapeHtml(q.company.name)}</div>
          ${q.company.legal ? `<div>${escapeHtml(q.company.legal)}</div>` : ''}
          ${q.company.reg ? `<div>Reg: ${escapeHtml(q.company.reg)}</div>` : ''}
          <div>${escapeHtml(q.company.address || '')}</div>
          <div>${escapeHtml(q.company.phone || '')} • ${escapeHtml(q.company.email || '')}</div>
        </div>
      </div>
      <div class="text-right">
        <h1 class="text-2xl font-semibold tracking-tight">Quote</h1>
        <div class="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-gray-600">
          <div class="font-medium text-gray-900">Quote #</div><div>${escapeHtml(q.quoteNumber)}</div>
          <div class="font-medium text-gray-900">Date</div><div>${escapeHtml(dateStr)}</div>
          <div class="font-medium text-gray-900">Valid Until</div><div>${escapeHtml(validStr)}</div>
        </div>
      </div>
    </header>

    <section class="mt-8 card rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.06)]">
      <div class="grid sm:grid-cols-2 gap-6 text-sm">
        <div>
          <div class="text-gray-500">Bill To</div>
          <div class="mt-1 font-medium text-gray-900">${escapeHtml(q.client.name || '')}</div>
          ${q.client.company ? `<div>${escapeHtml(q.client.company)}</div>` : ''}
          ${q.client.email ? `<div>${escapeHtml(q.client.email)}</div>` : ''}
          ${q.client.phone ? `<div>${escapeHtml(q.client.phone)}</div>` : ''}
          ${q.client.address ? `<div>${escapeHtml(q.client.address)}</div>` : ''}
        </div>
        <div>
          <div class="text-gray-500">Project / Notes</div>
          <div class="mt-1 text-gray-700">${escapeHtml(q.notes || 'PBX system configuration and number setup.')}</div>
        </div>
      </div>
    </section>

    <section class="mt-6 flex flex-wrap items-center gap-3">
      <div class="inline-flex items-baseline gap-2 rounded-full border border-gray-200 bg-gray-50 px-4 py-2">
        <span class="text-[11px] uppercase tracking-widest text-gray-500">Monthly</span>
        <span class="text-xl font-semibold text-gray-900">${zar(totalMonthly)}</span>
        <span class="text-gray-500">/mo</span>
      </div>
      <div class="inline-flex items-baseline gap-2 rounded-full border border-gray-200 bg-gray-50 px-4 py-2">
        <span class="text-[11px] uppercase tracking-widest text-gray-500">Once-off</span>
        <span class="text-xl font-semibold text-gray-900">${zar(totalOnce)}</span>
        <span class="text-gray-500">setup</span>
      </div>
    </section>

    <section class="mt-6 grid lg:grid-cols-2 gap-6">
      <div class="card rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold tracking-tight">Monthly Charges</h2>
          <span class="text-sm text-gray-500">Billed monthly</span>
        </div>
        <div class="mt-4 overflow-hidden rounded-xl border border-gray-100">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-gray-500">
              <tr>
                <th class="text-left p-3">Description</th>
                <th class="text-right p-3 w-28">Qty</th>
                <th class="text-right p-3 w-32">Amount</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              ${monthlyRows || `<tr><td class="p-3 text-gray-500" colspan="3">No monthly items.</td></tr>`}
            </tbody>
            <tfoot class="bg-gray-50">
              <tr><td class="p-3 text-right font-medium" colspan="2">Subtotal</td><td class="p-3 text-right font-semibold text-gray-900">${zar(q.subtotals.monthly)}</td></tr>
              <tr><td class="p-3 text-right font-medium" colspan="2">VAT (${Math.round(vatRate * 100)}%)</td><td class="p-3 text-right font-semibold text-gray-900">${zar(vatMonthly)}</td></tr>
              <tr><td class="p-3 text-right font-medium" colspan="2">Total / month</td><td class="p-3 text-right font-extrabold text-gray-900">${zar(totalMonthly)}</td></tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div class="card rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold tracking-tight">Once-off Charges</h2>
          <span class="text-sm text-gray-500">Setup & hardware</span>
        </div>
        <div class="mt-4 overflow-hidden rounded-xl border border-gray-100">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-gray-500">
              <tr>
                <th class="text-left p-3">Description</th>
                <th class="text-right p-3 w-28">Qty</th>
                <th class="text-right p-3 w-32">Amount</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              ${onceRows || `<tr><td class="p-3 text-gray-500" colspan="3">No once-off items.</td></tr>`}
            </tbody>
            <tfoot class="bg-gray-50">
              <tr><td class="p-3 text-right font-medium" colspan="2">Subtotal</td><td class="p-3 text-right font-semibold text-gray-900">${zar(q.subtotals.onceOff)}</td></tr>
              <tr><td class="p-3 text-right font-medium" colspan="2">VAT (${Math.round(vatRate * 100)}%)</td><td class="p-3 text-right font-semibold text-gray-900">${zar(vatOnce)}</td></tr>
              <tr><td class="p-3 text-right font-medium" colspan="2">Total (once-off)</td><td class="p-3 text-right font-extrabold text-gray-900">${zar(totalOnce)}</td></tr>
            </tfoot>
          </table>
        </div>
      </div>
    </section>

    <section class="mt-8 grid lg:grid-cols-12 gap-6">
      <div class="lg:col-span-7 card rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <h3 class="text-lg font-semibold tracking-tight">Included with your PBX</h3>
        <ul class="mt-4 grid sm:grid-cols-2 gap-3 text-sm">
          <li class="flex items-start gap-2">
            <span class="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#E7F0FF] text-[#0B63E6]">
              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4 10-10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            <span class="text-gray-700">Professional install & device setup</span>
          </li>
          <li class="flex items-start gap-2">
            <span class="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#E7F0FF] text-[#0B63E6]">
              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4 10-10" stroke="currentColor" stroke-width="2"/></svg>
            </span>
            <span class="text-gray-700">Remote support included</span>
          </li>
          <li class="flex items-start gap-2">
            <span class="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#E7F0FF] text-[#0B63E6]">
              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4 10-10" stroke="currentColor" stroke-width="2"/></svg>
            </span>
            <span class="text-gray-700">Number porting assistance</span>
          </li>
          <li class="flex items-start gap-2">
            <span class="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#E7F0FF] text-[#0B63E6]">
              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4 10-10" stroke="currentColor" stroke-width="2"/></svg>
            </span>
            <span class="text-gray-700">Core PBX features (transfer, voicemail, IVR, recording)</span>
          </li>
        </ul>
      </div>

      <div class="lg:col-span-5 card rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <h3 class="text-lg font-semibold tracking-tight">Totals</h3>
        <div class="mt-4 space-y-2 text-sm">
          <div class="flex items-center justify-between">
            <span class="text-gray-600">Monthly total</span>
            <span class="font-semibold text-gray-900">${zar(totalMonthly)}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-gray-600">Once-off total</span>
            <span class="font-semibold text-gray-900">${zar(totalOnce)}</span>
          </div>
          <hr class="my-3 border-gray-200">
          <div class="flex items-center justify-between">
            <span class="text-[1.05rem] font-semibold text-gray-900">Pay now (incl VAT)</span>
            <span class="text-[1.15rem] font-extrabold text-gray-900">${zar(grandPayNow)}</span>
          </div>
          <p class="mt-3 text-gray-600">
            Payment terms: once-off on installation; monthly fees billed in advance.
          </p>
        </div>
      </div>
    </section>

    <footer class="mt-8 text-xs text-gray-500">
      <p>This quote is valid for ${q.company.validityDays} days. Stock subject to availability. Pricing in ZAR.</p>
    </footer>
  </main>
</body>
</html>`;
}

/* ---------- LAUNCH HELPERS ---------- */
async function launchLambdaChromium() {
  const executablePath = await chromium.executablePath(); // null locally; path on Lambda/Vercel
  return pptrCore.launch({
    args: chromium.args,
    defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    executablePath,
    headless: chromium.headless
  });
}

async function launchPuppeteerFallback() {
  // Try an explicit system Chrome first if provided
  const systemChrome = process.env.CHROME_PATH || null; // e.g. '/usr/bin/google-chrome-stable'
  if (systemChrome) {
    return pptrCore.launch({
      executablePath: systemChrome,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }

  // Otherwise, use puppeteer (non-core) which bundles Chromium
  const puppeteer = (await import('puppeteer')).default;
  return puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
}

async function getBrowser() {
  const forceFallback = process.env.FORCE_PUPPETEER_FALLBACK === '1';

  if (!forceFallback) {
    try {
      const b = await launchLambdaChromium();
      console.log('[send-quote] Using Lambda Chromium');
      return b;
    } catch (err) {
      console.warn('[send-quote] Lambda Chromium failed, falling back:', String(err));
    }
  }

  const b2 = await launchPuppeteerFallback();
  console.log('[send-quote] Using Puppeteer fallback');
  return b2;
}
// ---------- HTML -> PDF ----------
async function htmlToPdfBuffer(html) {
  const executablePath = await chromium.executablePath();

  const browser = await pptrCore.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless
  });

  try {
    const page = await browser.newPage();
    await page.emulateMediaType('screen');
    await page.setContent(html, { waitUntil: ['networkidle0', 'domcontentloaded'] });
    await page.waitForTimeout(400); // give Tailwind a moment
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', right: '14mm', bottom: '16mm', left: '14mm' }
    });
  } finally {
    await browser.close();
  }
}


/* ---------------- API handler ---------------- */
export default async function handler(req, res) {
  // CORS for browser use
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const q = withDefaults(req.body || {});
    if (!q?.client?.email) return res.status(400).send('Missing client email.');

    const html = renderQuoteHTML(q);

    let pdfBuffer;
    try {
      pdfBuffer = await htmlToPdfBuffer(html);
    } catch (pdfErr) {
      console.error('[send-quote] PDF render failed:', pdfErr);
      // Keep going — send the email without attachment so the user still gets something.
    }

    const { data, error } = await resend.emails.send({
      from: 'sales@voipshop.co.za',
      to: q.client.email,
      reply_to: 'sales@voipshop.co.za',
      subject: `VoIP Shop Quote • ${q.quoteNumber}`,
      html: `<p>Hi ${escapeHtml(q.client.name || '')},</p>
             <p>Your quote is ${pdfBuffer ? 'attached as a PDF' : 'ready'}.</p>
             <p>If the PDF is missing, we will resend shortly.</p>
             <p>Regards,<br/>VoIP Shop</p>`,
      attachments: pdfBuffer
        ? [
            {
              filename: `Quote-${q.quoteNumber}.pdf`,
              content: pdfBuffer.toString('base64'),
              contentType: 'application/pdf'
            }
          ]
        : undefined
    });

    if (error) throw error;

    console.log('send-quote OK', { id: data?.id, to: q.client.email, quoteNumber: q.quoteNumber });
    res.status(200).json({
      ok: true,
      id: data?.id,
      usedFallback: Boolean(process.env.FORCE_PUPPETEER_FALLBACK === '1')
    });
  } catch (err) {
    console.error('send-quote error', err);
    res.status(500).send(String(err?.message || err) || 'Failed to send quote.');
  }
}
