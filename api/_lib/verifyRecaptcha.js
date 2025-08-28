// api/_lib/verifyRecaptcha.js
export async function verifyRecaptcha({ token, actionExpected, secret, remoteIp, minScore = 0.5 }) {
  if (!token) return { ok: false, reason: 'missing_token' };

  const params = new URLSearchParams();
  params.set('secret', secret || '');
  params.set('response', token);
  if (remoteIp) params.set('remoteip', remoteIp);

  const resp = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });

  let data = {};
  try { data = await resp.json(); } catch { /* ignore */ }

  // Log once on failure to see what Google said (remove later)
  if (!data?.success) {
    console.error('[recaptcha] verify failed:', {
      errorCodes: data['error-codes'],
      action: data.action,
      score: data.score,
      hostname: data.hostname
    });
    // Prefer Google’s error codes when present
    const codes = Array.isArray(data['error-codes']) ? data['error-codes'].join(',') : '';
    return { ok: false, reason: codes || 'verification_failed', data };
  }

  if (actionExpected && data.action && data.action !== actionExpected) {
    return { ok: false, reason: 'action_mismatch', data };
  }
  if (typeof data.score === 'number' && data.score < minScore) {
    return { ok: false, reason: 'low_score', data };
  }
  return { ok: true, data };
}
