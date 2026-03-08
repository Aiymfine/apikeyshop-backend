const pool = require('../db/pool');

// ─── Rolling Window Rate Limiter ─────────────────────────────────────────────
// Uses usage_counters table with 1-minute windows
// Atomic: INSERT ... ON CONFLICT DO UPDATE ensures no race conditions
async function rateLimitAndQuota(req, res, next) {
  const apiKey = req.apiKey;
  if (!apiKey) return next();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Get the plan for this key's customer
    const { rows: subs } = await client.query(
      `SELECT p.req_per_min, p.monthly_quota
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.customer_id = $1 AND s.status = 'active'
       ORDER BY s.created_at DESC LIMIT 1`,
      [apiKey.customer_id]
    );

    if (!subs.length) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'No active subscription' });
    }

    const { req_per_min, monthly_quota } = subs[0];

    // 2. Rolling window: truncate to current minute
    const windowStart = new Date();
    windowStart.setSeconds(0, 0); // floor to minute

    // Atomic upsert: increment counter for this window
    const { rows: windowRows } = await client.query(
      `INSERT INTO usage_counters (api_key_id, window_start, count)
       VALUES ($1, $2, 1)
       ON CONFLICT (api_key_id, window_start)
       DO UPDATE SET count = usage_counters.count + 1
       RETURNING count`,
      [apiKey.id, windowStart.toISOString()]
    );

    const currentWindowCount = windowRows[0].count;

    // 3. Check rate limit
    if (currentWindowCount > req_per_min) {
      await client.query('ROLLBACK');
      res.setHeader('X-RateLimit-Limit', req_per_min);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.setHeader('Retry-After', '60');
      return res.status(429).json({
        error: 'Rate limit exceeded',
        limit: req_per_min,
        window: '1 minute'
      });
    }

    // 4. Check monthly quota (upsert usage_monthly)
    const yearMonth = windowStart.toISOString().slice(0, 7); // "2024-03"
    const { rows: monthRows } = await client.query(
      `INSERT INTO usage_monthly (api_key_id, year_month, count)
       VALUES ($1, $2, 1)
       ON CONFLICT (api_key_id, year_month)
       DO UPDATE SET count = usage_monthly.count + 1
       RETURNING count`,
      [apiKey.id, yearMonth]
    );

    const monthlyCount = monthRows[0].count;

    if (monthlyCount > monthly_quota) {
      await client.query('ROLLBACK');
      return res.status(429).json({
        error: 'Monthly quota exceeded',
        quota: monthly_quota,
        used: monthlyCount - 1
      });
    }

    // 5. Also upsert usage_daily for billing aggregation
    const today = windowStart.toISOString().slice(0, 10);
    await client.query(
      `INSERT INTO usage_daily (api_key_id, date, count)
       VALUES ($1, $2, 1)
       ON CONFLICT (api_key_id, date)
       DO UPDATE SET count = usage_daily.count + 1`,
      [apiKey.id, today]
    );

    await client.query('COMMIT');

    // Attach headers for transparency
    res.setHeader('X-RateLimit-Limit', req_per_min);
    res.setHeader('X-RateLimit-Remaining', req_per_min - currentWindowCount);
    res.setHeader('X-Quota-Limit', monthly_quota);
    res.setHeader('X-Quota-Remaining', monthly_quota - monthlyCount);

    next();
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Rate limit error:', err);
    return res.status(500).json({ error: 'Internal error during rate check' });
  } finally {
    client.release();
  }
}

module.exports = { rateLimitAndQuota };
