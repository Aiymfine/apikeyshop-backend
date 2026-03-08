const express = require('express');
const pool = require('../db/pool');
const { requireApiKey } = require('../middleware/auth');
const { rateLimitAndQuota } = require('../middleware/ratelimit');

const router = express.Router();

// GET /v1/data - the protected API endpoint
// This simulates any API call a customer would make
router.get('/data', requireApiKey, rateLimitAndQuota, (req, res) => {
  res.json({
    message: 'Here is your protected data ✅',
    key_prefix: req.apiKey.key_prefix,
    timestamp: new Date().toISOString(),
    sample_data: {
      records: [
        { id: 1, value: 'Alpha', score: 0.95 },
        { id: 2, value: 'Beta',  score: 0.87 },
        { id: 3, value: 'Gamma', score: 0.72 }
      ]
    }
  });
});

// GET /usage/me - see your usage stats
router.get('/usage/me', requireApiKey, async (req, res) => {
  const yearMonth = new Date().toISOString().slice(0, 7);
  const today = new Date().toISOString().slice(0, 10);

  // Monthly usage
  const { rows: monthly } = await pool.query(
    `SELECT year_month, count FROM usage_monthly
     WHERE api_key_id = $1 AND year_month = $2`,
    [req.apiKey.id, yearMonth]
  );

  // Daily usage last 7 days
  const { rows: daily } = await pool.query(
    `SELECT date, count FROM usage_daily
     WHERE api_key_id = $1 AND date >= NOW() - INTERVAL '7 days'
     ORDER BY date DESC`,
    [req.apiKey.id]
  );

  // Plan limits
  const { rows: plan } = await pool.query(
    `SELECT p.req_per_min, p.monthly_quota, p.name
     FROM subscriptions s JOIN plans p ON p.id = s.plan_id
     WHERE s.customer_id = $1 AND s.status = 'active'
     ORDER BY s.created_at DESC LIMIT 1`,
    [req.apiKey.customer_id]
  );

  res.json({
    plan: plan[0] || null,
    current_month: yearMonth,
    monthly_used: monthly[0]?.count || 0,
    monthly_quota: plan[0]?.monthly_quota || 0,
    daily_breakdown: daily
  });
});

module.exports = router;
