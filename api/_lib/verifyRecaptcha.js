// /api/_lib/verifyRecaptcha.js
export async function verifyRecaptcha({ token, actionExpected, secret, remoteIp, minScore = 0.5 }) {
  if (!token) return { ok: false, reason: 'missing_token' };
  if (!secret) return { ok: false, reason: 'missing_secret' };

  const params = new URLSearchParams();
  params.set('secret', secret);
  params.set('response', token);
  if (remoteIp) params.set('remoteip', remoteIp);

  let data;
  try {
    const resp = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    data = await resp.json();
  } catch (e) {
    return { ok: false, reason: 'siteverify_fetch_failed', data: { error: String(e) } };
  }

  // Normalize important fields + error codes so we can see what's wrong.
  const out = {
    success: !!data?.success,
    score: typeof data?.score === 'number' ? data.score : null,
    action: data?.action || null,
    hostname: data?.hostname || null,
    errorCodes: data?.['error-codes'] || data?.error_codes || null
  };

  if (!out.success) return { ok: false, reason: 'verification_failed', data: out };
  if (actionExpected && out.action && out.action !== actionExpected) {
    return { ok: false, reason: 'action_mismatch', data: out };
  }
  if (typeof out.score === 'number' && out.score < minScore) {
    return { ok: false, reason: 'low_score', data: out };
  }
  return { ok: true, data: out };
}
