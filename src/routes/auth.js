const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../db/prisma');

const router = express.Router();

// POST /auth/register
router.post('/register', async (req, res) => {
  const { email, name, password } = req.body;
  if (!email || !name || !password)
    return res.status(400).json({ error: 'email, name, password required' });

  try {
    const hash = await bcrypt.hash(password, 12);

    const customer = await prisma.customers.create({
      data: { email, name, password_hash: hash },
      select: { id: true, email: true, name: true, created_at: true }
    });

    // Auto-subscribe to Free plan
    const freePlan = await prisma.plans.findFirst({
      where: { name: 'Free' }
    });

    await prisma.subscriptions.create({
      data: { customer_id: customer.id, plan_id: freePlan.id }
    });

    res.status(201).json({
      customer,
      message: 'Registered and subscribed to Free plan',
      token: Buffer.from(`${email}:${password}`).toString('base64')
    });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Email already exists' });
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'email and password required' });

  const customer = await prisma.customers.findUnique({
    where: { email }
  });

  if (!customer) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, customer.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  res.json({
    customer: { id: customer.id, email: customer.email, name: customer.name },
    token: Buffer.from(`${email}:${password}`).toString('base64')
  });
});

module.exports = router;