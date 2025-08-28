// api/_lib/verifyRecaptcha.js
export async function verifyRecaptcha({ token, actionExpected, secret, remoteIp, minScore = 0.5 }) {
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
  const data = await resp.json();

  // Expected fields: success, action, score, hostname
  if (!data.success) return { ok: false, reason: 'verification_failed', data };
  if (actionExpected && data.action !== actionExpected) {
    return { ok: false, reason: 'action_mismatch', data };
  }
  if (typeof data.score === 'number' && data.score < minScore) {
    return { ok: false, reason: 'low_score', data };
  }
  return { ok: true, data };
}
