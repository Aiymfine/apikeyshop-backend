const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../db/prisma');
const { requireCustomer } = require('../middleware/auth');

const router = express.Router();

function generateApiKey() {
  const prefixRandom = crypto.randomBytes(6).toString('hex');
  const secret = crypto.randomBytes(24).toString('hex');
  const prefix = `ak_${prefixRandom}`;
  const fullKey = `${prefix}_${secret}`;
  return { prefix, fullKey };
}

// POST /api-keys
router.post('/', requireCustomer, async (req, res) => {
  const { name } = req.body;

  const subscription = await prisma.subscriptions.findFirst({
    where: { customer_id: req.customer.id, status: 'active' }
  });

  if (!subscription)
    return res.status(403).json({ error: 'Active subscription required to issue API keys' });

  const { prefix, fullKey } = generateApiKey();
  const keyHash = await bcrypt.hash(fullKey, 10);

  const apiKey = await prisma.api_keys.create({
    data: {
      customer_id: req.customer.id,
      key_prefix: prefix,
      key_hash: keyHash,
      name: name || null
    },
    select: {
      id: true,
      key_prefix: true,
      name: true,
      status: true,
      created_at: true
    }
  });

  res.status(201).json({
    ...apiKey,
    raw_key: fullKey,
    warning: 'This is the only time your full API key will be shown. Store it now.'
  });
});

// GET /api-keys
router.get('/', requireCustomer, async (req, res) => {
  const keys = await prisma.api_keys.findMany({
    where: { customer_id: req.customer.id },
    select: {
      id: true,
      key_prefix: true,
      name: true,
      status: true,
      last_used_at: true,
      created_at: true
    },
    orderBy: { created_at: 'desc' }
  });
  res.json(keys);
});

// DELETE /api-keys/:id
router.delete('/:id', requireCustomer, async (req, res) => {
  const key = await prisma.api_keys.findFirst({
    where: {
      id: parseInt(req.params.id),
      customer_id: req.customer.id
    }
  });

  if (!key) return res.status(404).json({ error: 'Key not found or not yours' });

  const updated = await prisma.api_keys.update({
    where: { id: parseInt(req.params.id) },
    data: { status: 'revoked' },
    select: { id: true, key_prefix: true, status: true }
  });

  res.json({ message: 'Key revoked', key: updated });
});

module.exports = router;