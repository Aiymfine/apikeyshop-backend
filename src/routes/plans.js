const express = require('express');
const prisma = require('../db/prisma');
const { requireCustomer } = require('../middleware/auth');

const router = express.Router();

// GET /plans
router.get('/', async (req, res) => {
  const plans = await prisma.plans.findMany({
    orderBy: { price_cents: 'asc' }
  });
  res.json(plans);
});

// POST /plans
router.post('/', async (req, res) => {
  const { name, req_per_min, monthly_quota, price_cents } = req.body;
  if (!name || !req_per_min || !monthly_quota || price_cents === undefined)
    return res.status(400).json({ error: 'name, req_per_min, monthly_quota, price_cents required' });

  const plan = await prisma.plans.create({
    data: { name, req_per_min, monthly_quota, price_cents }
  });
  res.status(201).json(plan);
});

// POST /plans/subscribe
router.post('/subscribe', requireCustomer, async (req, res) => {
  const { plan_id } = req.body;
  if (!plan_id) return res.status(400).json({ error: 'plan_id required' });

  try {
    const plan = await prisma.plans.findUnique({
      where: { id: parseInt(plan_id) }
    });
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const result = await prisma.$transaction(async (tx) => {
      await tx.subscriptions.updateMany({
        where: { customer_id: req.customer.id, status: 'active' },
        data: { status: 'cancelled' }
      });

      const subscription = await tx.subscriptions.create({
        data: {
          customer_id: req.customer.id,
          plan_id: parseInt(plan_id),
          status: 'active'
        }
      });
      return subscription;
    });

    res.status(201).json({ subscription: result, plan });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Subscription failed' });
  }
});

// GET /plans/me
router.get('/me', requireCustomer, async (req, res) => {
  const subscription = await prisma.subscriptions.findFirst({
    where: { customer_id: req.customer.id, status: 'active' },
    orderBy: { created_at: 'desc' },
    include: { plans: true }
  });

  if (!subscription) return res.status(404).json({ error: 'No active subscription' });
  res.json(subscription);
});

module.exports = router;