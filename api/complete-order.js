// /api/complete-order.js

// --- Force Node runtime (NOT Edge) ---
export const config = { runtime: 'nodejs' };

// --- CORS allowlist (edit if needed) ---
const ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'https://voipshop.co.za',
  'https://www.voipshop.co.za',
  'https://voipshop-site.vercel.app'
]);

function setCors(res, origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://voipshop.co.za';
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Vary', 'Origin, Access-Control-Request-Headers');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24h
}

// --- reCAPTCHA v3 server verification ---
async function verifyRecaptchaV3({ token, action, remoteIp }) {
  const secret =
    process.env.RECAPTCHA_V3_SECRET_KEY ||
    process.env.RECAPTCHA_SECRET_KEY ||
    process.env.RECAPTCHA_SECRET ||
    '';

  const minScore = Number(process.env.RECAPTCHA_MIN_SCORE || 0.5);

  if (!secret) return { ok: false, reason: 'server_misconfigured_secret_missing' };
  if (!token) return { ok: false, reason: 'missing_token' };

  const params = new URLSearchParams();
  params.set('secret', secret);
  params.set('response', token);
  if (remoteIp) params.set('remoteip', remoteIp);

  const resp = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });

  const data = await resp.json().catch(() => ({}));

  if (!data?.success) return { ok: false, reason: 'verification_failed', data };
  if (action && data.action && data.action !== action) {
    return { ok: false, reason: 'action_mismatch', data };
  }
  if (typeof data.score === 'number' && data.score < minScore) {
    return { ok: false, reason: 'low_score', data };
  }
  return { ok: true, data };
}

export default async function handler(req, res) {
  try {
    const origin = req.headers.origin || '';
    setCors(res, origin);

    // ✅ Preflight first
    if (req.method === 'OPTIONS') return res.status(204).end();

    // ✅ Health check
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).json({ ok: true, info: 'complete-order API up' });
    }

    if (req.method !== 'POST') {
      res.setHeader('Content-Type', 'application/json');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // ---------- Parse & basic validation ----------
    const body = req.body || {};
    const {
      customer = {},       // { name, company, email, phone, address }
      onceOff = { items: [], totals: { exVat: 0 } },
      monthly = { items: [], totals: { exVat: 0 }, cloudPbxQty: 1, extensions: 3, didQty: 1, minutes: 250 },
      debit = {},          // { accountName, bank, branchCode, accountNumber, accountType, dayOfMonth }
      port = {},           // { provider, accountNumber, numbers[], ... }
      orderNumber,
      invoiceNumber,

      // reCAPTCHA v3 (sent by your securePost wrapper)
      recaptchaToken,
      recaptchaAction
    } = body;

    if (!customer?.email) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ error: 'Missing customer email.' });
    }

    // ---------- reCAPTCHA v3 verification ----------
    const remoteIp =
      (req.headers['x-forwarded-for'] || '').split(',')[0]?.trim() ||
      req.socket?.remoteAddress;
    const rc = await verifyRecaptchaV3({ token: recaptchaToken, action: recaptchaAction, remoteIp });

    if (!rc.ok) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({
        error: 'reCAPTCHA rejected',
        reason: rc.reason,
        meta: rc.data ? { action: rc.data.action, score: rc.data.score, hostname: rc.data.hostname } : undefined
      });
    }

    // ---------- Rate limit ----------
    const { enforceLimits } = await import('./_lib/rateLimit.js'); // lazy import
    const rl = await enforceLimits({
      ip: remoteIp || 'unknown',
      action: recaptchaAction || 'complete_order_bundle',
      email: customer?.email || ''
    });
    if (!rl.ok) {
      return res.status(429).json({
        error: 'Too many requests',
        retry_window: rl.hit.window,
        limit: rl.hit.limit,
        remaining: rl.hit.remaining
      });
    }

    // ---------- Lazy-load heavy modules AFTER captcha + RL pass ----------
    const [
      { buildInvoicePdfBuffer },
      { buildSlaPdfBuffer },
      { buildPortingPdfBuffer }
    ] = await Promise.all([
      import('./services/buildInvoicePdfBuffer.js'),
      import('./services/buildSlaPdfBuffer.js'),
      import('./services/buildPortingPdfBuffer.js')
    ]);

    // ---------- Email client (lazy import) ----------
    if (!process.env.RESEND_API_KEY) {
      console.error('[complete-order] Missing RESEND_API_KEY env var');
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ error: 'Server not configured (email).' });
    }
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    // ---------- Company defaults ----------
    const COMPANY = {
      name: 'VoIP Shop',
      reg: '2025/406791/07',
      vat: '***',
      address: '23 Lombardy Road, Broadacres, Johannesburg',
      phone: '+27 67 922 8256',
      email: 'sales@voipshop.co.za',
      website: 'https://voipshop.co.za',
      vatRate: 0.15,
      logoUrl: 'https://voipshop.co.za/Assets/Group%201642logo%20(1).png'
    };

    // ---------- Build PDF payloads ----------
    const invNumber = invoiceNumber || 'INV-' + Date.now();
    const ordNumber = orderNumber || 'VS-' + Math.floor(Math.random() * 1e6);

    const invoicePayload = {
      invoiceNumber: invNumber,
      orderNumber: ordNumber,
      dateISO: new Date().toISOString().slice(0, 10),
      client: {
        name: customer.name || customer.company || '',
        company: customer.company || '',
        email: customer.email,
        phone: customer.phone || '',
        address: customer.address || ''
      },
      itemsOnceOff: (onceOff.items || []).map(i => ({
        name: i.name, qty: Math.max(1, Number(i.qty || 1)), unit: Number(i.unit || 0)
      })),
      itemsMonthly: (monthly.items || []).map(i => ({
        name: i.name, qty: Math.max(1, Number(i.qty || 1)), unit: Number(i.unit || 0)
      })),
      subtotals: {
        onceOff: Number(onceOff?.totals?.exVat || 0),
        monthly: Number(monthly?.totals?.exVat || 0)
      },
      notes: 'Thank you for your order.',
      company: COMPANY,
      port // optional context for invoice footer, if your builder uses it
    };

    const slaPayload = {
      company: COMPANY,
      customer: {
        name: customer.company || customer.name || 'Customer',
        contact: customer.name || '',
        email: customer.email,
        phone: customer.phone || '',
        address: customer.address || ''
      },
      slaNumber: 'SLA-' + new Date().toISOString().slice(0,10).replace(/-/g,''),
      effectiveDateISO: new Date().toISOString().slice(0,10),
      noticeDays: 30,
      monthlyExVat: Number(monthly?.totals?.exVat || 0),
      monthlyInclVat: Number(monthly?.totals?.exVat || 0) * (1 + Number(COMPANY.vatRate || 0.15)),
      vatRate: Number(COMPANY.vatRate || 0.15),
      services: [
        { name: 'Cloud PBX', qty: Math.max(1, Number(monthly.cloudPbxQty || 1)) },
        { name: 'Extensions', qty: Math.max(0, Number(monthly.extensions || 3)) },
        { name: 'Geographic Number (DID)', qty: Math.max(0, Number(monthly.didQty || 1)) },
        { name: 'Voice Minutes (bundle)', qty: Math.max(0, Number(monthly.minutes || 250)), unit: 'min' }
      ],
      debitOrder: {
        accountName: debit.accountName || '',
        bank: debit.bank || '',
        branchCode: debit.branchCode || '',
        accountNumber: debit.accountNumber || '',
        accountType: debit.accountType || '',
        dayOfMonth: debit.dayOfMonth || '',
        mandateDateISO: new Date().toISOString().slice(0,10)
      },
      serviceDescription: 'Hosted PBX (incl. porting, device provisioning, remote support)'
    };

    const portingPayload = { company: COMPANY, client: invoicePayload.client, port };

    // ---------- Build PDFs in parallel ----------
    let invoicePdf, slaPdf, portingPdf;
    try {
      [invoicePdf, slaPdf, portingPdf] = await Promise.all([
        buildInvoicePdfBuffer(invoicePayload),  // Buffer
        buildSlaPdfBuffer(slaPayload),          // Buffer
        buildPortingPdfBuffer(portingPayload)   // Buffer
      ]);
    } catch (e) {
      console.error('[complete-order] PDF builder error:', e);
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ error: 'Failed to build one of the PDFs: ' + (e.message || String(e)) });
    }

    // ---------- 🧿 NEW: Persist artifacts (PDFs + snapshot) ----------
    const snapshot = {
      company: COMPANY,
      customer,
      invoicePayload,
      slaPayload: {
        ...slaPayload,
        // keep snapshot compact if you like
        services: slaPayload.services
      },
      portingPayload,
      onceOff,
      monthly,
      orderNumber: ordNumber,
      invoiceNumber: invNumber,
      dateISO: invoicePayload.dateISO
    };

    const { persistOrderArtifacts } = await import('./_lib/persist-order-artifacts.js');
    let links;
    try {
      links = await persistOrderArtifacts({
        orderNumber: ordNumber,
        invoiceNumber: invNumber,
        invoicePdfBuffer: invoicePdf,
        slaPdfBuffer: slaPdf,
        portingPdfBuffer: portingPdf,
        snapshot
      });
      // links = { invoiceUrl, slaUrl, portingUrl, metaUrl, orderNumber, invoiceNumber }
    } catch (e) {
      // If persistence fails, we still continue with email, but we’ll return no URLs.
      console.error('[complete-order] persistOrderArtifacts failed:', e);
      links = { orderNumber: ordNumber, invoiceNumber: invNumber };
    }

    // ---------- Compose email HTML ----------
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial;color:#111;max-width:600px;margin:0 auto;padding:24px;">
        <div style="text-align:center;margin-bottom:16px;">
          ${COMPANY.logoUrl ? `<img src="${COMPANY.logoUrl}" alt="${COMPANY.name}" style="height:36px;">` : ''}
        </div>

        <h2 style="margin:0 0 8px 0;font-size:18px;">Thank you for your order ${ordNumber}</h2>
        <p style="margin:8px 0 16px 0;">Hi ${invoicePayload.client.name || 'there'},</p>

        <p style="margin:0 0 12px 0;">
          Thanks for choosing <strong>${COMPANY.name}</strong>. Please see attached:
        </p>
        <ul style="margin:0 0 16px 20px; padding:0;">
          <li>Invoice <strong>${invNumber}</strong></li>
          <li>Service Level Agreement (SLA)</li>
          <li>Porting Letter of Authority (LOA)</li>
        </ul>

        <p style="margin:0 0 12px 0;">
          To proceed with number porting, please <strong>sign the LOA</strong> and return it together with:
        </p>
        <ul style="margin:0 0 16px 20px; padding:0;">
          <li>Your latest telephone account</li>
          <li>Your company letterhead</li>
          <li>A copy of the account holder’s ID</li>
        </ul>

        <p style="margin:0 0 12px 0;">
          You can email the documents to <a href="mailto:sales@voipshop.co.za">sales@voipshop.co.za</a>
          or upload them via the <strong>Completed Order</strong> section on our website.
        </p>

        <p style="margin:0 0 12px 0;">
          A support agent will contact you shortly to confirm your order and to schedule an installation time.
          Please note: installation will be scheduled once the invoice is paid.
        </p>

        <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />

        <p style="margin:0 0 4px 0;"><strong>${COMPANY.name}</strong></p>
        <p style="margin:0 0 2px 0;">${COMPANY.address}</p>
        <p style="margin:0 0 2px 0;">${COMPANY.phone} • <a href="mailto:${COMPANY.email}">${COMPANY.email}</a></p>
        ${COMPANY.website ? `<p style="margin:0;"><a href="${COMPANY.website}">${COMPANY.website}</a></p>` : ''}
      </div>`;

    // ---------- Send email (attachments) ----------
    const { error, data } = await resend.emails.send({
      from: 'sales@voipshop.co.za', // must be verified in Resend
      to: invoicePayload.client.email,
      cc: ['sales@voipshop.co.za'], // ✅ always CC sales
      reply_to: 'sales@voipshop.co.za',
      subject: `Order ${ordNumber} • Invoice, SLA & Porting • VoIP Shop`,
      html,
      attachments: [
        { filename: `Invoice-${invNumber}.pdf`,        content: invoicePdf.toString('base64'), contentType: 'application/pdf' },
        { filename: `Service-Level-Agreement.pdf`,     content: slaPdf.toString('base64'),     contentType: 'application/pdf' },
        { filename: `Porting-Letter-of-Authority.pdf`, content: portingPdf.toString('base64'), contentType: 'application/pdf' }
      ]
    });

    if (error) {
      console.error('[complete-order] Resend error:', error);
      res.setHeader('Content-Type', 'application/json');
      // Even if email fails, return the persisted URLs (if we got them) so UI can proceed
      return res.status(502).json({
        error: 'Email send failed: ' + (error?.message || 'unknown'),
        orderNumber: ordNumber,
        invoiceNumber: invNumber,
        ...links
      });
    }

    // ---------- Success response (includes URLs for front-end wiring) ----------
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({
      ok: true,
      id: data?.id,
      orderNumber: ordNumber,
      invoiceNumber: invNumber,
      ...links // => invoiceUrl, slaUrl, portingUrl, metaUrl
    });
  } catch (err) {
    console.error('[complete-order] handler error:', err);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ error: String(err?.message || err) || 'Failed to complete order.' });
  }
}
