const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../db/prisma');
const { issueCustomerToken, requireCustomer } = require('../middleware/auth');

const router = express.Router();

// POST /auth/register
router.post('/register', async (req, res) => {
  const { email, name, password, platform_id } = req.body;
  if (!email || !name || !password || !platform_id) {
    return res.status(400).json({ error: 'email, name, password, platform_id required' });
  }

  try {
    const platform = await prisma.platforms.findFirst({
      where: { id: parseInt(platform_id, 10), is_active: true }
    });
    if (!platform) return res.status(404).json({ error: 'Platform not found or inactive' });

    const hash = await bcrypt.hash(password, 12);

    const customer = await prisma.customers.create({
      data: {
        email,
        name,
        password_hash: hash,
        platform_id: platform.id,
        role: 'customer'
      },
      select: { id: true, email: true, name: true, created_at: true, platform_id: true, role: true }
    });

    // Auto-subscribe to this platform's Free plan.
    const freePlan = await prisma.plans.findFirst({
      where: { platform_id: platform.id, name: 'Free' }
    });

    if (freePlan) {
      await prisma.subscriptions.create({
        data: {
          customer_id: customer.id,
          platform_id: platform.id,
          plan_id: freePlan.id
        }
      });
    }

    const token = issueCustomerToken(customer);

    res.status(201).json({
      customer,
      message: freePlan
        ? 'Registered and subscribed to Free plan'
        : 'Registered. No Free plan is configured for this platform yet.',
      token
    });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Email already exists' });
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password, platform_id } = req.body;
  if (!email || !password || !platform_id) {
    return res.status(400).json({ error: 'email, password, platform_id required' });
  }

  const customer = await prisma.customers.findFirst({
    where: { email, platform_id: parseInt(platform_id, 10) }
  });

  if (!customer) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, customer.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = issueCustomerToken(customer);
  res.json({
    customer: {
      id: customer.id,
      email: customer.email,
      name: customer.name,
      role: customer.role,
      platform_id: customer.platform_id
    },
    token
  });
});

router.get('/me', requireCustomer, async (req, res) => {
  res.json({
    id: req.customer.id,
    email: req.customer.email,
    name: req.customer.name,
    role: req.customer.role,
    platform_id: req.customer.platform_id
  });
});

module.exports = router;