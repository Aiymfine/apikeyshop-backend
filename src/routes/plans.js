const express = require('express');
const pool = require('../db/pool');
const { requireCustomer } = require('../middleware/auth');

const router = express.Router();

// GET /plans - list all plans
router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM plans ORDER BY price_cents ASC'
  );
  res.json(rows);
});

// POST /plans - create a plan (admin use)
router.post('/', async (req, res) => {
  const { name, req_per_min, monthly_quota, price_cents } = req.body;
  if (!name || !req_per_min || !monthly_quota || price_cents === undefined)
    return res.status(400).json({ error: 'name, req_per_min, monthly_quota, price_cents required' });

  const { rows } = await pool.query(
    `INSERT INTO plans (name, req_per_min, monthly_quota, price_cents)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, req_per_min, monthly_quota, price_cents]
  );
  res.status(201).json(rows[0]);
});

// POST /subscribe - subscribe to a plan
router.post('/subscribe', requireCustomer, async (req, res) => {
  const { plan_id } = req.body;
  if (!plan_id) return res.status(400).json({ error: 'plan_id required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check plan exists
    const { rows: plans } = await client.query(
      'SELECT * FROM plans WHERE id = $1', [plan_id]
    );
    if (!plans.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Plan not found' });
    }

    // Cancel existing active subscription
    await client.query(
      `UPDATE subscriptions SET status = 'cancelled'
       WHERE customer_id = $1 AND status = 'active'`,
      [req.customer.id]
    );

    // Create new subscription
    const { rows } = await client.query(
      `INSERT INTO subscriptions (customer_id, plan_id, status, current_period_start, current_period_end)
       VALUES ($1, $2, 'active', NOW(), NOW() + INTERVAL '30 days')
       RETURNING *`,
      [req.customer.id, plan_id]
    );

    await client.query('COMMIT');
    res.status(201).json({
      subscription: rows[0],
      plan: plans[0]
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Subscription failed' });
  } finally {
    client.release();
  }
});

// GET /subscribe/me - get my current subscription
router.get('/me', requireCustomer, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.*, p.name as plan_name, p.req_per_min, p.monthly_quota, p.price_cents
     FROM subscriptions s
     JOIN plans p ON p.id = s.plan_id
     WHERE s.customer_id = $1 AND s.status = 'active'
     ORDER BY s.created_at DESC LIMIT 1`,
    [req.customer.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'No active subscription' });
  res.json(rows[0]);
});

module.exports = router;
