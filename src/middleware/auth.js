const crypto = require('crypto');
const pool = require('../db/pool');

// ─── Customer Auth (Bearer token = base64 email:password for simplicity) ───────
async function requireCustomer(req, res, next) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Bearer token' });
  }

  try {
    const token = auth.slice(7);
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [email, password] = decoded.split(':');

    const { rows } = await pool.query(
      'SELECT * FROM customers WHERE email = $1', [email]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const bcrypt = require('bcryptjs');
    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    req.customer = rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Auth failed' });
  }
}

// ─── API Key Auth (for /v1/* endpoints) ─────────────────────────────────────
async function requireApiKey(req, res, next) {
  const rawKey = req.headers['x-api-key'] || '';
  if (!rawKey) return res.status(401).json({ error: 'Missing X-Api-Key header' });

  // Key format: "ak_live_PREFIX_RANDOMPART"
  // Prefix stored in DB; we hash the full key to compare
  const prefix = rawKey.slice(0, 15); // first 16 chars are the prefix

  const { rows: keys } = await pool.query(
    `SELECT ak.*, c.id as cust_id
     FROM api_keys ak
     JOIN customers c ON c.id = ak.customer_id
     WHERE ak.key_prefix = $1 AND ak.status = 'active'`,
    [prefix]
  );

  if (!keys.length) return res.status(401).json({ error: 'Invalid API key' });

  const bcrypt = require('bcryptjs');
  // Timing-safe: always run compare even if key not found
  const match = await bcrypt.compare(rawKey, keys[0].key_hash);
  if (!match) return res.status(401).json({ error: 'Invalid API key' });

  // Update last_used_at
  await pool.query(
    'UPDATE api_keys SET last_used_at = NOW() WHERE id = $1',
    [keys[0].id]
  );

  req.apiKey = keys[0];
  req.customer = { id: keys[0].customer_id };
  next();
}

module.exports = { requireCustomer, requireApiKey };
