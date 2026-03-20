const bcrypt = require('bcryptjs');
const prisma = require('../db/prisma');

// Customer Auth (Bearer token)
async function requireCustomer(req, res, next) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Bearer token' });
  }

  try {
    const token = auth.slice(7);
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [email, password] = decoded.split(':');

    const customer = await prisma.customers.findUnique({
      where: { email }
    });

    if (!customer) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, customer.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    req.customer = customer;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Auth failed' });
  }
}

// API Key Auth
async function requireApiKey(req, res, next) {
  const rawKey = req.headers['x-api-key'] || '';
  if (!rawKey) return res.status(401).json({ error: 'Missing X-Api-Key header' });

  const prefix = rawKey.slice(0, 15);

  const apiKey = await prisma.api_keys.findFirst({
    where: { key_prefix: prefix, status: 'active' }
  });

  if (!apiKey) return res.status(401).json({ error: 'Invalid API key' });

  const match = await bcrypt.compare(rawKey, apiKey.key_hash);
  if (!match) return res.status(401).json({ error: 'Invalid API key' });

  await prisma.api_keys.update({
    where: { id: apiKey.id },
    data: { last_used_at: new Date() }
  });

  req.apiKey = apiKey;
  req.customer = { id: apiKey.customer_id };
  next();
}

module.exports = { requireCustomer, requireApiKey };