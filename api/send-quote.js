// /api/send-quote.js
export const config = { runtime: 'nodejs' };

import { Resend } from 'resend';
import { put } from '@vercel/blob';
import { buildQuotePdfBuffer } from './services/buildQuotePdfBuffer.js';
import { verifyRecaptcha } from './_lib/verifyRecaptcha.js';
import { enforceLimits } from './_lib/rateLimit.js';

const resend = new Resend(process.env.RESEND_API_KEY);
const COMPLETE_ORDER_URL = process.env.COMPLETE_ORDER_URL || 'https://voipshop.co.za/complete-order';

/* ===== COMPANY DEFAULTS (unchanged) ===== */
const COMPANY_DEFAULTS = {
  name: 'VoIP Shop',
  address: '23 Lombardy Road, Broadacres, Johannesburg',
  phone: '+27 68 351 0074',
  email: 'sales@voipshop.co.za',
  vatRate: 0.15,
  validityDays: 7,
  logoUrl: 'https://voipshop.co.za/Assets/Group%201642logo%20(1).png',
  colors: {
    brand: '#0B63E6',
    ink:   '#0f172a',
    gray6: '#475569',
    gray4: '#94a3b8',
    line:  '#e5e7eb',
    thbg:  '#f8fafc',
    pill:  '#f1f5f9'
  }
};

const money = (n) =>
  'R ' + Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function withDefaults(input = {}) {
  const company = { ...COMPANY_DEFAULTS, ...(input.company || {}) };
  if (!company.colors) company.colors = COMPANY_DEFAULTS.colors;

  const norm = (arr = []) =>
    Array.isArray(arr)
      ? arr.map((it) => ({
          name: String(it.name ?? it.desc ?? ''),
          qty: Number(it.qty ?? it.quantity ?? 1),
          unit: Number(it.unit ?? it.price ?? 0),
          minutes: it.minutes ?? it.includedMinutes
        }))
      : [];

  return {
    quoteNumber: input.quoteNumber || 'Q-' + Date.now(),
    dateISO: input.dateISO || new Date().toISOString().slice(0, 10),
    validDays: Number(input.validDays ?? company.validityDays ?? 7),
    client: { ...(input.client || {}) },
    itemsOnceOff: norm(input.itemsOnceOff),
    itemsMonthly: norm(input.itemsMonthly),
    subtotals: {
      onceOff: Number(input?.subtotals?.onceOff || 0),
      monthly: Number(input?.subtotals?.monthly || 0)
    },
    notes: input.notes || 'PBX system configuration and number setup.',
    stamp: input.stamp || '', // 'DRAFT' | 'PAID'
    compact: !!input.compact,
    company
  };
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

/** Primary CTA email (when delivery=link) — includes subtle download link */
function emailBodyLinkDelivery({ brand, clientName, monthlyInclVat, pdfUrl }) {
  const pre = `Thanks for requesting a quote — monthly est. ${money(monthlyInclVat)}`;
  return `
  <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">${escapeHtml(pre)}</div>
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial;color:#111;max-width:600px;margin:0 auto;padding:24px;">
    <div style="text-align:center;margin-bottom:16px;">
      ${brand.logoUrl ? `<img src="${brand.logoUrl}" alt="${escapeHtml(brand.name)}" style="height:36px;">` : ''}
    </div>

    <h2 style="margin:0 0 8px 0;font-size:18px;">Thank you for requesting a quote</h2>
    <p style="margin:8px 0 12px 0;">Hi ${escapeHtml(clientName || '')},</p>

    <p style="margin:0 0 12px 0;">
      We’ve prepared your quote. Your estimated <strong>monthly bill is ${money(monthlyInclVat)}</strong>.
      If you have any questions, call us on <strong>${escapeHtml(brand.phone || '')}</strong> or reply to this email.
    </p>

    <p style="text-align:center;margin:20px 0;">
      <a href="${COMPLETE_ORDER_URL}" style="background:#111;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;display:inline-block;">
        Complete Your Order
      </a>
    </p>

    <p style="margin:12px 0 0 0;font-size:14px;">
      Prefer to save the quote? <a href="${pdfUrl}">Download your Quote (PDF)</a>
    </p>

    <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
    <p style="margin:0 0 4px 0;"><strong>${escapeHtml(brand.name)}</strong></p>
    <p style="margin:0 0 2px 0;">${escapeHtml(brand.address || '')}</p>
    <p style="margin:0 0 2px 0;">${escapeHtml(brand.phone || '')} • <a href="mailto:${escapeHtml(brand.email || '')}">${escapeHtml(brand.email || '')}</a></p>
  </div>`;
}

/** Attachment delivery — same structure, no download link (PDF is attached) */
function emailBodyAttachmentDelivery({ brand, clientName, monthlyInclVat }) {
  const pre = `Thanks for requesting a quote — monthly est. ${money(monthlyInclVat)}`;
  return `
  <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">${escapeHtml(pre)}</div>
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial;color:#111;max-width:600px;margin:0 auto;padding:24px;">
    <div style="text-align:center;margin-bottom:16px;">
      ${brand.logoUrl ? `<img src="${brand.logoUrl}" alt="${escapeHtml(brand.name)}" style="height:36px;">` : ''}
    </div>

    <h2 style="margin:0 0 8px 0;font-size:18px;">Thank you for requesting a quote</h2>
    <p style="margin:8px 0 12px 0;">Hi ${escapeHtml(clientName || '')},</p>

    <p style="margin:0 0 12px 0;">
      We’ve prepared your quote (attached). Your estimated <strong>monthly bill is ${money(monthlyInclVat)}</strong>.
      If you have any questions, call us on <strong>${escapeHtml(brand.phone || '')}</strong> or reply to this email.
    </p>

    <p style="text-align:center;margin:20px 0;">
      <a href="${COMPLETE_ORDER_URL}" style="background:#111;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;display:inline-block;">
        Complete Your Order
      </a>
    </p>

    <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
    <p style="margin:0 0 4px 0;"><strong>${escapeHtml(brand.name)}</strong></p>
    <p style="margin:0 0 2px 0;">${escapeHtml(brand.address || '')}</p>
    <p style="margin:0 0 2px 0;">${escapeHtml(brand.phone || '')} • <a href="mailto:${escapeHtml(brand.email || '')}">${escapeHtml(brand.email || '')}</a></p>
  </div>`;
}

export default async function handler(req, res) {
  // --- CORS (simple) ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Flags
  const explicitPreview =
    (req.query?.preview === '1' || req.query?.preview === 'true') ||
    (req.body?.preview === true || req.body?.preview === '1');
  const compactFlag =
    (req.query?.compact === '1' || req.query?.compact === 'true') ||
    (req.body?.compact === true || req.body?.compact === '1');

  const isPost = req.method === 'POST';
  const body = isPost ? (req.body || {}) : {};
  const base = withDefaults({ ...body, compact: compactFlag });

  try {
    // ✅ reCAPTCHA v3: run only for POST (email flows)
    if (isPost) {
      const token = body?.recaptchaToken;
      const action = body?.recaptchaAction; // e.g., 'send_quote_button' | 'complete_order_quote'
      const secret = process.env.RECAPTCHA_SECRET;
      const remoteIp =
        (req.headers['x-forwarded-for'] || '').split(',')[0]?.trim() ||
        req.socket?.remoteAddress;

      const check = await verifyRecaptcha({
        token,
        actionExpected: action,
        secret,
        remoteIp,
        minScore: Number(process.env.RECAPTCHA_MIN_SCORE || 0.5)
      });

      if (!check.ok) {
        return res.status(400).json({
          error: 'reCAPTCHA rejected',
          reason: check.reason,
          meta: check.data ? { action: check.data.action, score: check.data.score, hostname: check.data.hostname } : undefined
        });
      }

      // 🔒 Rate limit (after captcha, before heavy work)
      const ip = remoteIp || 'unknown';
      const emailForRl = base?.client?.email || '';
      const rl = await enforceLimits({
        ip,
        action: action || 'send_quote',
        email: emailForRl
      });
      if (!rl.ok) {
        return res.status(429).json({
          error: 'Too many requests',
          retry_window: rl.hit.window,
          limit: rl.hit.limit,
          remaining: rl.hit.remaining
        });
      }
    }

    // Build PDF buffer via service
    const pdfBuffer = await buildQuotePdfBuffer(base);

    // Preview vs Email
    const noEmail = !base?.client?.email;
    const isPreview = explicitPreview || req.method === 'GET' || noEmail;

    if (isPreview) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename=Quote-${base.quoteNumber}.pdf`);
      return res.status(200).send(pdfBuffer);
    }

    // Email flow
    if (!process.env.RESEND_API_KEY) {
      console.error('[send-quote] Missing RESEND_API_KEY env var');
      return res.status(500).send('Server not configured (email).');
    }

    const delivery =
      (body.delivery || '').toLowerCase() ||
      (process.env.USE_BLOB_LINK ? 'link' : 'attach');

    const from = 'sales@voipshop.co.za';
    const to = base.client.email;
    const subject = `VoIP Shop Quote • ${base.quoteNumber}`;
    const monthlyInclVat = Number(base.subtotals.monthly || 0) * (1 + Number(base.company.vatRate ?? 0.15));

    if (delivery === 'link') {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        console.error('[send-quote] Missing BLOB_READ_WRITE_TOKEN for link delivery');
        return res.status(500).send('BLOB_READ_WRITE_TOKEN not set for link delivery.');
      }

      const keyPart = String(base.quoteNumber).replace(/[^\w\-]+/g, '-');
      const objectPath = `quotes/${new Date().toISOString().slice(0,10)}/quote-${keyPart}.pdf`;

      const { url: pdfUrl } = await put(objectPath, pdfBuffer, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        contentType: 'application/pdf',
        addRandomSuffix: false
      });

      const { error } = await resend.emails.send({
        from, to, cc: ['sales@voipshop.co.za'], reply_to: from, subject,
        html: emailBodyLinkDelivery({
          brand: base.company,
          clientName: base.client.name,
          monthlyInclVat,
          pdfUrl
        })
      });
      if (error) {
        console.error('[send-quote] Resend send error (link):', error);
        return res.status(502).send('Email send failed: ' + (error?.message || 'unknown'));
      }
      return res.status(200).json({ ok: true, delivery: 'link', pdfUrl });
    } else {
      const { error, data } = await resend.emails.send({
        from, to, cc: ['sales@voipshop.co.za'], reply_to: from, subject,
        html: emailBodyAttachmentDelivery({
          brand: base.company,
          clientName: base.client.name,
          monthlyInclVat
        }),
        attachments: [
          { filename: `Quote-${base.quoteNumber}.pdf`, content: pdfBuffer.toString('base64'), contentType: 'application/pdf' }
        ]
      });
      if (error) {
        console.error('[send-quote] Resend send error (attach):', error);
        return res.status(502).send('Email send failed: ' + (error?.message || 'unknown'));
      }
      return res.status(200).json({ ok: true, delivery: 'attach', id: data?.id });
    }
  } catch (err) {
    console.error('[send-quote] error:', err);
    return res.status(500).send(String(err?.message || err) || 'Failed to create/send quote.');
  }
}
