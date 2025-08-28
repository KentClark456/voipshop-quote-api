// /api/send-invoice.js
export const config = { runtime: 'nodejs' };

import { Resend } from 'resend';
import { put } from '@vercel/blob';
import { buildInvoicePdfBuffer } from './services/buildInvoicePdfBuffer.js';
import { verifyRecaptcha } from './_lib/verifyRecaptcha.js';
import { enforceLimits } from './_lib/rateLimit.js';

const resend = new Resend(process.env.RESEND_API_KEY);

const COMPANY_DEFAULTS = {
  name: 'VoIP Shop',
  address: '23 Lombardy Road, Broadacres, Johannesburg',
  phone: '+27 67 922 8256',
  email: 'sales@voipshop.co.za',
  vatRate: 0.15,
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
    invoiceNumber: input.invoiceNumber || 'INV-' + Date.now(),
    orderNumber: input.orderNumber || input.invoiceNumber || 'VS-' + Math.floor(Math.random() * 1e6),
    dateISO: input.dateISO || new Date().toISOString().slice(0, 10),
    dueDays: Number(input.dueDays || 7),
    client: { ...(input.client || {}) },
    itemsOnceOff: norm(input.itemsOnceOff),
    itemsMonthly: norm(input.itemsMonthly),
    subtotals: {
      onceOff: Number(input?.subtotals?.onceOff || 0),
      monthly: Number(input?.subtotals?.monthly || 0)
    },
    notes: input.notes || 'Thank you for your order.',
    stamp: input.stamp || '',
    compact: !!input.compact,
    company
  };
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

function emailBodyWithLink({ brand, clientName, invoiceNumber, orderNumber, pdfUrl }) {
  const pre = `Your invoice ${invoiceNumber} for order ${orderNumber} is ready`;
  return `
  <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">${escapeHtml(pre)}</div>
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial;color:#111;max-width:560px;margin:0 auto;padding:24px;">
    <div style="text-align:center;margin-bottom:16px;">
      ${brand.logoUrl ? `<img src="${brand.logoUrl}" alt="${escapeHtml(brand.name)}" style="height:36px;">` : ''}
    </div>
    <p>Hi ${escapeHtml(clientName || '')},</p>
    <p>Your <strong>invoice ${escapeHtml(invoiceNumber)}</strong> for order <strong>${escapeHtml(orderNumber)}</strong> is ready.</p>
    <p style="text-align:center;margin:24px 0;">
      <a href="${pdfUrl}" style="background:#111;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;display:inline-block;">
        Download Invoice (PDF)
      </a>
    </p>
    <p>— ${escapeHtml(brand.name)} Team</p>
  </div>`;
}

function emailBodyTiny({ brand, clientName, invoiceNumber, orderNumber }) {
  const pre = `Your invoice ${invoiceNumber} for order ${orderNumber} is attached`;
  return `
  <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">${escapeHtml(pre)}</div>
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial;color:#111;max-width:560px;margin:0 auto;padding:24px;">
    <div style="text-align:center;margin-bottom:16px;">
      ${brand.logoUrl ? `<img src="${brand.logoUrl}" alt="${escapeHtml(brand.name)}" style="height:36px;">` : ''}
    </div>
    <p>Hi ${escapeHtml(clientName || '')},</p>
    <p>Your <strong>invoice ${escapeHtml(invoiceNumber)}</strong> for order <strong>${escapeHtml(orderNumber)}</strong> is attached as a PDF.</p>
    <p>— ${escapeHtml(brand.name)} Team</p>
  </div>`;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const body = req.method === 'POST' ? (req.body || {}) : {};
  const base = withDefaults(body);

  try {
    // ✅ reCAPTCHA (POST only)
    if (req.method === 'POST') {
      const token = body?.recaptchaToken;
      const action = body?.recaptchaAction || 'send_invoice';
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
      const rl = await enforceLimits({
        ip: remoteIp || 'unknown',
        action,
        email: base?.client?.email || ''
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

    const pdfBuffer = await buildInvoicePdfBuffer(base);

    const noEmail = !base?.client?.email;
    const isPreview = req.method === 'GET' || noEmail;

    if (isPreview) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename=Invoice-${base.invoiceNumber}.pdf`);
      return res.status(200).send(pdfBuffer);
    }

    // Delivery: link vs attach
    if (!process.env.RESEND_API_KEY) {
      console.error('[send-invoice] Missing RESEND_API_KEY env var');
      return res.status(500).send('Server not configured (email).');
    }

    const delivery =
      (body.delivery || '').toLowerCase() ||
      (process.env.USE_BLOB_LINK ? 'link' : 'attach');

    const from = 'sales@voipshop.co.za';
    const to = base.client.email;
    const subject = `VoIP Shop Invoice • ${base.invoiceNumber} • Order ${base.orderNumber}`;

    if (delivery === 'link') {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        console.error('[send-invoice] Missing BLOB_READ_WRITE_TOKEN for link delivery');
        return res.status(500).send('BLOB_READ_WRITE_TOKEN not set for link delivery.');
      }

      const keyPart = String(base.invoiceNumber).replace(/[^\w\-]+/g, '-');
      const objectPath = `invoices/${new Date().toISOString().slice(0,10)}/invoice-${keyPart}.pdf`;

      const { url: pdfUrl } = await put(objectPath, pdfBuffer, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        contentType: 'application/pdf',
        addRandomSuffix: false
      });

      const { error } = await resend.emails.send({
        from, to, reply_to: from, subject,
        html: emailBodyWithLink({
          brand: base.company,
          clientName: base.client.name,
          invoiceNumber: base.invoiceNumber,
          orderNumber: base.orderNumber,
          pdfUrl
        })
      });
      if (error) {
        console.error('[send-invoice] Resend send error (link):', error);
        return res.status(502).send('Email send failed: ' + (error?.message || 'unknown'));
      }
      return res.status(200).json({ ok: true, delivery: 'link', pdfUrl });
    } else {
      const { error, data } = await resend.emails.send({
        from, to, reply_to: from, subject,
        html: emailBodyTiny({
          brand: base.company,
          clientName: base.client.name,
          invoiceNumber: base.invoiceNumber,
          orderNumber: base.orderNumber
        }),
        attachments: [
          { filename: `Invoice-${base.invoiceNumber}.pdf`, content: pdfBuffer.toString('base64'), contentType: 'application/pdf' }
        ]
      });
      if (error) {
        console.error('[send-invoice] Resend send error (attach):', error);
        return res.status(502).send('Email send failed: ' + (error?.message || 'unknown'));
      }
      return res.status(200).json({ ok: true, delivery: 'attach', id: data?.id });
    }
  } catch (err) {
    console.error('send-invoice error', err);
    return res.status(500).send(String(err?.message || err) || 'Failed to create/send invoice.');
  }
}
