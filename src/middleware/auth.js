const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../db/prisma');

function getJwtSecret() {
  return process.env.JWT_SECRET || 'dev-jwt-secret-change-me';
}

function issueCustomerToken(customer) {
  return jwt.sign(
    {
      sub: customer.id,
      platform_id: customer.platform_id,
      role: customer.role
    },
    getJwtSecret(),
    { expiresIn: '7d' }
  );
}

// Customer Auth (JWT Bearer token)
async function requireCustomer(req, res, next) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Bearer token' });
  }

  try {
    const token = auth.slice(7);
    const decoded = jwt.verify(token, getJwtSecret());

    const customer = await prisma.customers.findFirst({
      where: {
        id: Number(decoded.sub),
        platform_id: decoded.platform_id
      }
    });

    if (!customer) return res.status(401).json({ error: 'Invalid token subject' });

    req.customer = customer;
    req.platform_id = customer.platform_id;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Auth failed' });
  }
}

// API Key Auth
async function requireApiKey(req, res, next) {
  const rawKey = req.headers['x-api-key'] || '';
  if (!rawKey) return res.status(401).json({ error: 'Missing X-Api-Key header' });

  const platformIdHeader = req.headers['x-platform-id'];
  const platformId = platformIdHeader ? parseInt(platformIdHeader, 10) : null;

  const prefix = rawKey.slice(0, 15);

  const apiKey = await prisma.api_keys.findFirst({
    where: {
      key_prefix: prefix,
      status: 'active',
      ...(platformId ? { platform_id: platformId } : {})
    }
  });

  if (!apiKey) return res.status(401).json({ error: 'Invalid API key' });

  const match = await bcrypt.compare(rawKey, apiKey.key_hash);
  if (!match) return res.status(401).json({ error: 'Invalid API key' });

  await prisma.api_keys.update({
    where: { id: apiKey.id },
    data: { last_used_at: new Date() }
  });

  const customer = await prisma.customers.findFirst({
    where: { id: apiKey.customer_id, platform_id: apiKey.platform_id }
  });

  req.apiKey = apiKey;
  req.customer = customer || {
    id: apiKey.customer_id,
    platform_id: apiKey.platform_id,
    role: 'customer'
  };
  req.platform_id = apiKey.platform_id;
  next();
}

function requireOwner(req, res, next) {
  if (!req.customer || req.customer.role !== 'owner') {
    return res.status(403).json({ error: 'Owner access required' });
  }
  next();
}

module.exports = { requireCustomer, requireApiKey, requireOwner, issueCustomerToken };