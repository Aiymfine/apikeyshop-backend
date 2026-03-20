const express = require('express');
const prisma = require('../db/prisma');
const { requireApiKey } = require('../middleware/auth');
const { rateLimitAndQuota } = require('../middleware/ratelimit');

const router = express.Router();

// GET /v1/data - protected endpoint
router.get('/data', requireApiKey, rateLimitAndQuota, (req, res) => {
  res.json({
    message: 'Here is your protected data ✅',
    key_prefix: req.apiKey.key_prefix,
    timestamp: new Date().toISOString(),
    sample_data: {
      records: [
        { id: 1, value: 'Alpha', score: 0.95 },
        { id: 2, value: 'Beta', score: 0.87 },
        { id: 3, value: 'Gamma', score: 0.72 }
      ]
    }
  });
});

// GET /v1/usage/me
router.get('/usage/me', requireApiKey, async (req, res) => {
  const yearMonth = new Date().toISOString().slice(0, 7);

  const monthly = await prisma.usage_monthly.findUnique({
    where: {
      api_key_id_year_month: {
        api_key_id: req.apiKey.id,
        year_month: yearMonth
      }
    }
  });

  const daily = await prisma.usage_daily.findMany({
    where: {
      api_key_id: req.apiKey.id,
      date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    },
    orderBy: { date: 'desc' }
  });

  const subscription = await prisma.subscriptions.findFirst({
    where: { customer_id: req.apiKey.customer_id, status: 'active' },
    orderBy: { created_at: 'desc' },
    include: { plans: true }
  });

  res.json({
    plan: subscription?.plans || null,
    current_month: yearMonth,
    monthly_used: monthly?.count || 0,
    monthly_quota: subscription?.plans?.monthly_quota || 0,
    daily_breakdown: daily
  });
});

module.exports = router;