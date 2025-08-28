// /api/send-porting.js
export const config = { runtime: 'nodejs' };

import { Resend } from 'resend';
import { buildPortingPdfBuffer } from './services/buildPortingPdfBuffer.js';
import { verifyRecaptcha } from './_lib/verifyRecaptcha.js';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  // ----- CORS (reflect origin like your current code) -----
  const origin = req.headers.origin || '*';
  const acrh   = req.headers['access-control-request-headers'] || '';
  res.setHeader('Vary', 'Origin, Access-Control-Request-Headers');
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', acrh || 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).send('Method Not Allowed');

  try {
    const body = req.body || {};
    const {
      company = {
        name: 'VoIP Shop',
        logoUrl: 'https://voipshop.co.za/Assets/Group%201642logo%20(1).png'
      },
      client = {}, // { name, company, email, phone, address }
      port   = {}  // { provider, accountNumber, numbers[], serviceAddress, pbxLocation, contactNumber, idNumber, authorisedName, authorisedTitle }

      // Expect v3 token from frontend securePost(..., 'complete_order_porting')
    } = body;

    // ----- reCAPTCHA v3 check (required for POST) -----
    const token = body?.recaptchaToken;
    const action = body?.recaptchaAction; // e.g. 'complete_order_porting'
    const secret = process.env.RECAPTCHA_SECRET;
    const remoteIp =
      (req.headers['x-forwarded-for'] || '').split(',')[0]?.trim() ||
      req.socket?.remoteAddress;

    const rc = await verifyRecaptcha({
      token,
      actionExpected: action,
      secret,
      remoteIp,
      minScore: Number(process.env.RECAPTCHA_MIN_SCORE || 0.5)
    });

    if (!rc.ok) {
      return res.status(400).json({
        error: 'reCAPTCHA rejected',
        reason: rc.reason,
        meta: rc.data ? { action: rc.data.action, score: rc.data.score, hostname: rc.data.hostname } : undefined
      });
    }

    if (!client?.email) return res.status(400).send('Missing client email.');

    // 1) Build LOA PDF
    const portingPdf = await buildPortingPdfBuffer({ company, client, port });

    // 2) Send email via Resend
    if (!process.env.RESEND_API_KEY) {
      console.error('[send-porting] Missing RESEND_API_KEY env var');
      return res.status(500).send('Server not configured (email).');
    }

    const { error, data } = await resend.emails.send({
      from: 'sales@voipshop.co.za',
      to: client.email,
      reply_to: 'sales@voipshop.co.za',
      subject: `Porting Letter of Authority • ${client.company || client.name || ''}`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial;color:#111;max-width:560px;margin:0 auto;padding:24px;">
          <div style="text-align:center;margin-bottom:16px;">
            ${company.logoUrl ? `<img src="${company.logoUrl}" alt="${company.name}" style="height:36px;">` : ''}
          </div>
          <p>Hi ${client.name || 'there'},</p>
          <p>Your <strong>Porting Letter of Authority</strong> is attached. Please sign and return it to proceed with number porting.</p>
          <p>— ${company.name} Team</p>
        </div>`,
      attachments: [
        {
          filename: `Porting-Letter-of-Authority.pdf`,
          content: portingPdf.toString('base64'),
          contentType: 'application/pdf'
        }
      ]
    });

    if (error) {
      console.error('[send-porting] Resend error:', error);
      return res.status(502).send('Email send failed: ' + (error?.message || 'unknown'));
    }

    return res.status(200).json({ ok: true, id: data?.id, attached: { porting: true } });
  } catch (err) {
    console.error('[send-porting] error', err);
    return res.status(500).send(String(err?.message || err) || 'Failed to create/send porting LOA.');
  }
}
