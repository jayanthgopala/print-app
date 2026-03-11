const rateLimitStore = new Map();

function getNumber(c, key, fallback) {
  const processValue = typeof process !== 'undefined' ? process.env[key] : undefined;
  const value = c.env?.[key] ?? processValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function rateLimiter(options = {}) {
  const { windowMs, maxRequests, keyGenerator } = options;

  return async (c, next) => {
    const resolvedWindowMs = windowMs ?? getNumber(c, 'RATE_LIMIT_WINDOW_MS', 900000);
    const resolvedMaxRequests = maxRequests ?? getNumber(c, 'RATE_LIMIT_MAX_REQUESTS', 100);
    const resolvedKeyGenerator =
      keyGenerator ||
      ((ctx) => {
        const shopCode = ctx.get('shopCode');
        if (shopCode) return `shop:${shopCode}`;

        const forwarded = ctx.req.header('x-forwarded-for');
        const ip = forwarded ? forwarded.split(',')[0] : ctx.req.header('x-real-ip') || 'unknown';
        return `ip:${ip}`;
      });

    const key = resolvedKeyGenerator(c);
    const now = Date.now();
    const windowStart = now - resolvedWindowMs;

    let record = rateLimitStore.get(key);

    if (!record) {
      record = { requests: [], resetTime: now + resolvedWindowMs };
      rateLimitStore.set(key, record);
    }

    record.requests = record.requests.filter((time) => time > windowStart);

    if (record.requests.length >= resolvedMaxRequests) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);

      c.header('Retry-After', retryAfter.toString());
      c.header('X-RateLimit-Limit', resolvedMaxRequests.toString());
      c.header('X-RateLimit-Remaining', '0');
      c.header('X-RateLimit-Reset', record.resetTime.toString());

      return c.json(
        {
          error: 'Too many requests',
          retryAfter,
        },
        429
      );
    }

    record.requests.push(now);

    c.header('X-RateLimit-Limit', resolvedMaxRequests.toString());
    c.header('X-RateLimit-Remaining', (resolvedMaxRequests - record.requests.length).toString());
    c.header('X-RateLimit-Reset', record.resetTime.toString());

    await next();
  };
}

if (typeof process !== 'undefined' && process.versions?.node) {
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
      if (record.resetTime < now) {
        rateLimitStore.delete(key);
      }
    }
  }, 60000);
}

export function loginRateLimiter() {
  return rateLimiter({
    windowMs: 900000,
    maxRequests: 5,
    keyGenerator: (c) => {
      const forwarded = c.req.header('x-forwarded-for');
      const ip = forwarded ? forwarded.split(',')[0] : c.req.header('x-real-ip') || 'unknown';
      return `login:${ip}`;
    },
  });
}

export function printJobRateLimiter() {
  return rateLimiter({
    windowMs: 60000,
    maxRequests: 10,
  });
}

export default rateLimiter;
