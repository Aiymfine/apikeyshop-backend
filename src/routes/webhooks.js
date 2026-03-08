const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const { requireCustomer } = require('../middleware/auth');
const { fireWebhookEvent, signPayload } = require('../services/webhook');

const router = express.Router();

// POST /webhooks - register a webhook endpoint
router.post('/', requireCustomer, async (req, res) => {
  const { url, events } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  // Generate a signing secret for this endpoint
  const secret = crypto.randomBytes(32).toString('hex');

  const { rows } = await pool.query(
    `INSERT INTO webhook_endpoints (customer_id, url, secret, events)
     VALUES ($1, $2, $3, $4) RETURNING id, url, events, is_active, created_at`,
    [req.customer.id, url, secret, events || []]
  );

  res.status(201).json({
    ...rows[0],
    signing_secret: secret,  // shown once
    warning: 'Store your signing secret securely. It will not be shown again.'
  });
});

// GET /webhooks - list my endpoints
router.get('/', requireCustomer, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, url, events, is_active, created_at FROM webhook_endpoints
     WHERE customer_id = $1 ORDER BY created_at DESC`,
    [req.customer.id]
  );
  res.json(rows);
});

// POST /webhooks/test-fire - manually fire a test event
router.post('/test-fire', requireCustomer, async (req, res) => {
  const { event_type, payload } = req.body;
  if (!event_type) return res.status(400).json({ error: 'event_type required' });

  const testPayload = payload || { test: true, timestamp: new Date().toISOString() };

  await fireWebhookEvent(req.customer.id, event_type, testPayload);

  res.json({
    message: `Event '${event_type}' queued for delivery`,
    payload: testPayload
  });
});

// GET /webhooks/attempts - see delivery history + retry status
router.get('/attempts', requireCustomer, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT wa.id, wa.event_type, wa.status, wa.attempt_count,
            wa.next_retry_at, wa.last_response, wa.last_attempted_at, wa.created_at,
            we.url
     FROM webhook_attempts wa
     JOIN webhook_endpoints we ON we.id = wa.endpoint_id
     WHERE we.customer_id = $1
     ORDER BY wa.created_at DESC
     LIMIT 50`,
    [req.customer.id]
  );
  res.json(rows);
});

module.exports = router;
