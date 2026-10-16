/**
 * Fixed-window in-memory rate limiter. Per server instance only — on a
 * multi-instance deployment put a shared limiter (e.g. at the edge/WAF) in
 * front. Bounded map size prevents memory growth from many distinct keys.
 */
export interface RateLimiter {
  check(key: string, now?: number): { allowed: boolean; remaining: number; resetAt: number };
}

export function createRateLimiter(opts: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const maxKeys = opts.maxKeys ?? 10_000;
  return {
    check(key, now = Date.now()) {
      let b = buckets.get(key);
      if (!b || b.resetAt <= now) {
        if (buckets.size >= maxKeys) {
          for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
          if (buckets.size >= maxKeys) {
            const oldest = buckets.keys().next().value;
            if (oldest !== undefined) buckets.delete(oldest);
          }
        }
        b = { count: 0, resetAt: now + opts.windowMs };
        buckets.set(key, b);
      }
      b.count += 1;
      return { allowed: b.count <= opts.limit, remaining: Math.max(0, opts.limit - b.count), resetAt: b.resetAt };
    },
  };
}
