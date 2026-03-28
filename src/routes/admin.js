const express = require('express');
const prisma = require('../db/prisma');
const { requireCustomer, requireOwner } = require('../middleware/auth');

const router = express.Router();
router.use(requireCustomer, requireOwner);

// GET /v1/admin/customers
router.get('/customers', async (req, res) => {
  const customers = await prisma.customers.findMany({
    where: { platform_id: req.customer.platform_id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      created_at: true
    },
    orderBy: { created_at: 'desc' }
  });

  return res.json(customers);
});

// GET /v1/admin/revenue
router.get('/revenue', async (req, res) => {
  const invoices = await prisma.invoices.findMany({
    where: {
      platform_id: req.customer.platform_id,
      status: { in: ['issued', 'paid'] }
    },
    select: { total_cents: true }
  });

  const totalCents = invoices.reduce((sum, inv) => sum + inv.total_cents, 0);
  return res.json({
    invoice_count: invoices.length,
    total_cents: totalCents,
    total_usd: (totalCents / 100).toFixed(2)
  });
});

// GET /v1/admin/usage
router.get('/usage', async (req, res) => {
  const keys = await prisma.api_keys.findMany({
    where: { platform_id: req.customer.platform_id },
    select: { id: true }
  });

  const apiKeyIds = keys.map((k) => k.id);
  if (apiKeyIds.length === 0) {
    return res.json({ total_api_keys: 0, last_7_days_requests: 0, current_month_requests: 0 });
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const yearMonth = new Date().toISOString().slice(0, 7);

  const [daily, monthly] = await Promise.all([
    prisma.usage_daily.findMany({
      where: { api_key_id: { in: apiKeyIds }, date: { gte: since } },
      select: { count: true }
    }),
    prisma.usage_monthly.findMany({
      where: { api_key_id: { in: apiKeyIds }, year_month: yearMonth },
      select: { count: true }
    })
  ]);

  return res.json({
    total_api_keys: apiKeyIds.length,
    last_7_days_requests: daily.reduce((sum, row) => sum + row.count, 0),
    current_month_requests: monthly.reduce((sum, row) => sum + row.count, 0)
  });
});

module.exports = router;
