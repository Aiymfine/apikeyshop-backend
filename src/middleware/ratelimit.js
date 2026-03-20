const prisma = require('../db/prisma');

async function rateLimitAndQuota(req, res, next) {
  const apiKey = req.apiKey;
  if (!apiKey) return next();

  try {
    // 1. Get active subscription + plan
    const subscription = await prisma.subscriptions.findFirst({
      where: { customer_id: apiKey.customer_id, status: 'active' },
      orderBy: { created_at: 'desc' },
      include: { plans: true }
    });

    if (!subscription) {
      return res.status(403).json({ error: 'No active subscription' });
    }

    const { req_per_min, monthly_quota } = subscription.plans;

    // 2. Rolling window - truncate to current minute
    const windowStart = new Date();
    windowStart.setSeconds(0, 0);

    // 3. Atomic upsert for rate limiting
    const counter = await prisma.$executeRaw`
      INSERT INTO usage_counters (api_key_id, window_start, count)
      VALUES (${apiKey.id}, ${windowStart}, 1)
      ON CONFLICT (api_key_id, window_start)
      DO UPDATE SET count = usage_counters.count + 1
    `;

    const windowRow = await prisma.usage_counters.findUnique({
      where: {
        api_key_id_window_start: {
          api_key_id: apiKey.id,
          window_start: windowStart
        }
      }
    });

    const currentWindowCount = windowRow?.count || 1;

    // 4. Check rate limit
    if (currentWindowCount > req_per_min) {
      res.setHeader('X-RateLimit-Limit', req_per_min);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.setHeader('Retry-After', '60');
      return res.status(429).json({
        error: 'Rate limit exceeded',
        limit: req_per_min,
        window: '1 minute'
      });
    }

    // 5. Atomic upsert for monthly quota
    const yearMonth = windowStart.toISOString().slice(0, 7);

    await prisma.$executeRaw`
      INSERT INTO usage_monthly (api_key_id, year_month, count)
      VALUES (${apiKey.id}, ${yearMonth}, 1)
      ON CONFLICT (api_key_id, year_month)
      DO UPDATE SET count = usage_monthly.count + 1
    `;

    const monthRow = await prisma.usage_monthly.findUnique({
      where: {
        api_key_id_year_month: {
          api_key_id: apiKey.id,
          year_month: yearMonth
        }
      }
    });

    const monthlyCount = monthRow?.count || 1;

    // 6. Check monthly quota
    if (monthlyCount > monthly_quota) {
      return res.status(429).json({
        error: 'Monthly quota exceeded',
        quota: monthly_quota,
        used: monthlyCount - 1
      });
    }

    // 7. Track daily usage
    const today = windowStart.toISOString().slice(0, 10);
    await prisma.$executeRaw`
      INSERT INTO usage_daily (api_key_id, date, count)
      VALUES (${apiKey.id}, ${today}::date, 1)
      ON CONFLICT (api_key_id, date)
      DO UPDATE SET count = usage_daily.count + 1
    `;

    // 8. Set headers
    res.setHeader('X-RateLimit-Limit', req_per_min);
    res.setHeader('X-RateLimit-Remaining', req_per_min - currentWindowCount);
    res.setHeader('X-Quota-Limit', monthly_quota);
    res.setHeader('X-Quota-Remaining', monthly_quota - monthlyCount);

    next();
  } catch (err) {
    console.error('Rate limit error:', err);
    return res.status(500).json({ error: 'Internal error during rate check' });
  }
}

module.exports = { rateLimitAndQuota };