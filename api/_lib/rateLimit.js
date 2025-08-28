// /api/_lib/rateLimit.js
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// Reuse across routes
const redis = Redis.fromEnv();

// Sliding window limiters
export const perIpMinute = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, '1 m') });
export const perIpDay    = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(50, '24 h') });

export const perEmailHour = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(3, '1 h') });
export const perEmailDay  = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '24 h') });

export async function enforceLimits({ ip, action, email }) {
  const ipKeyM = `rl:${action}:ip:1m:${ip}`;
  const ipKeyD = `rl:${action}:ip:1d:${ip}`;
  const emKeyH = `rl:${action}:email:1h:${email}`;
  const emKeyD = `rl:${action}:email:1d:${email}`;

  const [m, d, eh, ed] = await Promise.all([
    perIpMinute.limit(ipKeyM),
    perIpDay.limit(ipKeyD),
    perEmailHour.limit(emKeyH),
    perEmailDay.limit(emKeyD),
  ]);

  // return first violation
  const hit =
    (!m.success && { window: '1m', limit: m.limit, remaining: m.remaining }) ||
    (!d.success && { window: '24h', limit: d.limit, remaining: d.remaining }) ||
    (!eh.success && { window: '1h/email', limit: eh.limit, remaining: eh.remaining }) ||
    (!ed.success && { window: '24h/email', limit: ed.limit, remaining: ed.remaining });

  return hit ? { ok: false, hit } : { ok: true };
}
