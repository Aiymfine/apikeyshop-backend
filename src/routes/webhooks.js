const express = require('express');
const crypto = require('crypto');
const prisma = require('../db/prisma');
const { requireCustomer } = require('../middleware/auth');
const { fireWebhookEvent } = require('../services/webhook');

const router = express.Router();

// POST /webhooks
router.post('/', requireCustomer, async (req, res) => {
  const { url, events } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  const secret = crypto.randomBytes(32).toString('hex');

  const endpoint = await prisma.webhook_endpoints.create({
    data: {
      customer_id: req.customer.id,
      platform_id: req.customer.platform_id,
      url,
      secret,
      events: events || []
    },
    select: {
      id: true,
      url: true,
      events: true,
      is_active: true,
      created_at: true
    }
  });

  res.status(201).json({
    ...endpoint,
    signing_secret: secret,
    warning: 'Store your signing secret securely. It will not be shown again.'
  });
});

// GET /webhooks
router.get('/', requireCustomer, async (req, res) => {
  const endpoints = await prisma.webhook_endpoints.findMany({
    where: {
      customer_id: req.customer.id,
      platform_id: req.customer.platform_id
    },
    select: {
      id: true,
      url: true,
      events: true,
      is_active: true,
      created_at: true
    },
    orderBy: { created_at: 'desc' }
  });
  res.json(endpoints);
});

// POST /webhooks/test-fire
router.post('/test-fire', requireCustomer, async (req, res) => {
  const { event_type, payload } = req.body;
  if (!event_type) return res.status(400).json({ error: 'event_type required' });

  const testPayload = payload || { test: true, timestamp: new Date().toISOString() };

  await fireWebhookEvent(req.customer.id, req.customer.platform_id, event_type, testPayload);

  res.json({
    message: `Event '${event_type}' queued for delivery`,
    payload: testPayload
  });
});

// GET /webhooks/attempts
router.get('/attempts', requireCustomer, async (req, res) => {
  const attempts = await prisma.webhook_attempts.findMany({
    where: {
      webhook_endpoints: {
        customer_id: req.customer.id,
        platform_id: req.customer.platform_id
      }
    },
    include: {
      webhook_endpoints: {
        select: { url: true }
      }
    },
    orderBy: { created_at: 'desc' },
    take: 50
  });

  res.json(attempts);
});

module.exports = router;