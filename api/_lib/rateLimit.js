// /api/_lib/rateLimit.js
// Tries to use Upstash if env+deps exist; otherwise falls back to "allow".
let limiterPromise = null;

async function getLimiter() {
  if (limiterPromise) return limiterPromise;
  limiterPromise = (async () => {
    try {
      const url = process.env.UPSTASH_REDIS_REST_URL;
      const token = process.env.UPSTASH_REDIS_REST_TOKEN;
      if (!url || !token) return null;

      const { Ratelimit } = await import('@upstash/ratelimit');
      const { Redis } = await import('@upstash/redis'); // Upstash Redis REST SDK
      const redis = new Redis({ url, token });

      // Tune the window/limit as you like
      return new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(10, '1 m'),
        prefix: 'voipshop:rl'
      });
    } catch (e) {
      console.warn('[rateLimit] Upstash not available, disabling RL:', e?.message || e);
      return null;
    }
  })();
  return limiterPromise;
}

export async function enforceLimits({ ip = 'unknown', action = 'generic', email = '' } = {}) {
  try {
    const limiter = await getLimiter();
    if (!limiter) {
      // No deps/env => allow
      return { ok: true, hit: { limit: 0, remaining: 0, window: 'disabled' } };
    }
    const key = ['rl', action, email || ip].filter(Boolean).join(':');
    const r = await limiter.limit(key);
    return { ok: r.success, hit: { limit: r.limit, remaining: r.remaining, window: '1m' } };
  } catch (e) {
    console.warn('[rateLimit] error, allowing request:', e?.message || e);
    return { ok: true, hit: { limit: 0, remaining: 0, window: 'disabled' } };
  }
}
