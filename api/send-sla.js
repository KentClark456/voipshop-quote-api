// /api/send-sla.js
export const config = { runtime: 'nodejs' };

import { verifyRecaptcha } from './_lib/verifyRecaptcha.js';
import { enforceLimits } from './_lib/rateLimit.js';
import { buildSlaPdfBuffer } from './services/buildSlaPdfBuffer.js';

export default async function handler(req, res) {
  // --- CORS (simple) ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  try {
    const checkout = req.body || {};

    // ---- reCAPTCHA v3 (expect action: "complete_order_sla" or "send_sla") ----
    const token = checkout?.recaptchaToken;
    const action = checkout?.recaptchaAction || 'send_sla';
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

    // ---- Rate limit (after captcha, before heavy work) ----
    const ip = remoteIp || 'unknown';
    const emailForRl = checkout?.customer?.email || '';
    const rl = await enforceLimits({ ip, action, email: emailForRl });
    if (!rl.ok) {
      return res.status(429).json({
        error: 'Too many requests',
        retry_window: rl.hit.window,
        limit: rl.hit.limit,
        remaining: rl.hit.remaining
      });
    }

    // ---- Build SLA payload (same logic you had) ----
    const services = [
      { name: 'Cloud PBX',               qty: Number(checkout?.monthly?.cloudPbxQty ?? 1) },
      { name: 'Extensions',              qty: Number(checkout?.monthly?.extensions ?? 3) },
      { name: 'Geographic Number (DID)', qty: Number(checkout?.monthly?.didQty ?? 1) },
      { name: 'Voice Minutes (bundle)',  qty: Number(checkout?.monthly?.minutes ?? 250), unit: 'min' }
    ];

    const debitOrder = {
      accountName:   checkout?.debit?.accountName || '',
      bank:          checkout?.debit?.bank || '',
      branchCode:    checkout?.debit?.branchCode || '',
      accountNumber: checkout?.debit?.accountNumber || '',
      accountType:   checkout?.debit?.accountType || '',
      dayOfMonth:    checkout?.debit?.dayOfMonth || '',
      mandateDateISO: new Date().toISOString().slice(0,10)
    };

    const pdf = await buildSlaPdfBuffer({
      company: {
        name: 'VoIP Shop',
        reg: '2025/406791/07',
        vat: '***',
        address: '23 Lombardy Road, Broadacres, Johannesburg',
        phone: '+27 68 351 0074',
        email: 'sales@voipshop.co.za',
        website: 'https://voipshop.co.za',
        logoUrl: 'https://voipshop.co.za/Assets/Group%201642logo%20(1).png'
      },
      customer: {
        name:    checkout?.customer?.company || checkout?.customer?.name || 'Customer',
        contact: checkout?.customer?.contact || '',
        email:   checkout?.customer?.email || '',
        phone:   checkout?.customer?.phone || '',
        address: checkout?.customer?.address || '',
        reg:     checkout?.customer?.reg || '',
        vat:     checkout?.customer?.vat || ''
      },
      slaNumber:        checkout?.slaNumber || ('SLA-' + new Date().toISOString().slice(0,10).replace(/-/g,'')),
      effectiveDateISO: checkout?.effectiveDate || new Date().toISOString().slice(0,10),
      noticeDays: 30,
      monthlyExVat:   Number(checkout?.monthly?.totals?.exVat ?? 0),
      monthlyInclVat: Number(checkout?.monthly?.totals?.inclVat ?? 0),
      vatRate: 0.15,
      services,
      debitOrder,
      serviceDescription: 'Hosted PBX (incl. porting, device provisioning, remote support)'
    });

    // ---- Return PDF inline ----
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${checkout?.slaNumber || 'SLA'}.pdf"`);
    return res.status(200).send(pdf);
  } catch (err) {
    console.error('[send-sla] error:', err);
    return res.status(500).json({ error: 'Error generating SLA PDF', detail: String(err?.message || err) });
  }
}
