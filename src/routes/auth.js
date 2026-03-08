const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

const router = express.Router();

// POST /auth/register
router.post('/register', async (req, res) => {
  const { email, name, password } = req.body;
  if (!email || !name || !password)
    return res.status(400).json({ error: 'email, name, password required' });

  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO customers (email, name, password_hash)
       VALUES ($1, $2, $3) RETURNING id, email, name, created_at`,
      [email, name, hash]
    );

    // Auto-subscribe to Free plan
    await pool.query(
      `INSERT INTO subscriptions (customer_id, plan_id)
       SELECT $1, id FROM plans WHERE name = 'Free' LIMIT 1`,
      [rows[0].id]
    );

    res.status(201).json({
      customer: rows[0],
      message: 'Registered and subscribed to Free plan',
      // Token = base64(email:password) - simple for midterm
      token: Buffer.from(`${email}:${password}`).toString('base64')
    });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'email and password required' });

  const { rows } = await pool.query(
    'SELECT * FROM customers WHERE email = $1', [email]
  );

  if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, rows[0].password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  res.json({
    customer: { id: rows[0].id, email: rows[0].email, name: rows[0].name },
    token: Buffer.from(`${email}:${password}`).toString('base64')
  });
});

module.exports = router;
