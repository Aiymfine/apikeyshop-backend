const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { requireCustomer } = require('../middleware/auth');

const router = express.Router();

// ─── Key Generation ───────────────────────────────────────────────────────────
// Format: ak_live_XXXXXXXXXXXXXXXX_YYYYYYYYYYYYYYYYYYYYYYYYYYYY
// PREFIX (16 chars stored plain) + SECRET (32 chars, only hash stored)
function generateApiKey() {
  const prefixRandom = crypto.randomBytes(6).toString('hex');   // 12 hex chars
  const secret = crypto.randomBytes(24).toString('hex');         // 48 hex chars
  const prefix = `ak_${prefixRandom}`;                          // e.g. ak_a1b2c3d4e5f6
  const fullKey = `${prefix}_${secret}`;
  return { prefix, fullKey };
}

// POST /api-keys - issue a new API key
// ⚠️  The raw key is shown ONCE and never again
router.post('/', requireCustomer, async (req, res) => {
  const { name } = req.body;

  // Check customer has active subscription
  const { rows: subs } = await pool.query(
    `SELECT id FROM subscriptions WHERE customer_id = $1 AND status = 'active' LIMIT 1`,
    [req.customer.id]
  );
  if (!subs.length)
    return res.status(403).json({ error: 'Active subscription required to issue API keys' });

  const { prefix, fullKey } = generateApiKey();

  // Hash the full key with bcrypt (cost 10 is fine for keys)
  const keyHash = await bcrypt.hash(fullKey, 10);

  const { rows } = await pool.query(
    `INSERT INTO api_keys (customer_id, key_prefix, key_hash, name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, key_prefix, name, status, created_at`,
    [req.customer.id, prefix, keyHash, name || null]
  );

  // Return the full key ONCE - it will never be retrievable again
  res.status(201).json({
    ...rows[0],
    raw_key: fullKey,  // ⚠️ SHOW ONCE - store this securely
    warning: 'This is the only time your full API key will be shown. Store it now.'
  });
});

// GET /api-keys - list my keys (prefix + metadata only, never the secret)
router.get('/', requireCustomer, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, key_prefix, name, status, last_used_at, created_at
     FROM api_keys
     WHERE customer_id = $1
     ORDER BY created_at DESC`,
    [req.customer.id]
  );
  res.json(rows);
});

// DELETE /api-keys/:id - revoke a key
router.delete('/:id', requireCustomer, async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE api_keys
     SET status = 'revoked'
     WHERE id = $1 AND customer_id = $2
     RETURNING id, key_prefix, status`,
    [req.params.id, req.customer.id]
  );

  if (!rows.length)
    return res.status(404).json({ error: 'Key not found or not yours' });

  res.json({ message: 'Key revoked', key: rows[0] });
});

module.exports = router;
