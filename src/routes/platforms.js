const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../db/prisma');
const { requireCustomer, issueCustomerToken } = require('../middleware/auth');

const router = express.Router();

function toSlug(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function seedDefaultPlans(tx, platformId) {
  const defaults = [
    { name: 'Free', req_per_min: 10, monthly_quota: 1000, price_cents: 0 },
    { name: 'Starter', req_per_min: 60, monthly_quota: 50000, price_cents: 999 },
    { name: 'Pro', req_per_min: 300, monthly_quota: 500000, price_cents: 4999 }
  ];

  for (const plan of defaults) {
    await tx.plans.create({
      data: { ...plan, platform_id: platformId }
    });
  }
}

// POST /v1/platforms/register
router.post('/register', async (req, res) => {
  const { email, name, password, platform_name, slug, domain, description } = req.body;
  if (!email || !name || !password || !platform_name) {
    return res.status(400).json({
      error: 'email, name, password, platform_name required'
    });
  }

  const platformSlug = toSlug(slug || platform_name);
  if (!platformSlug) return res.status(400).json({ error: 'Invalid platform slug' });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const passwordHash = await bcrypt.hash(password, 12);

      const owner = await tx.customers.create({
        data: {
          email,
          name,
          password_hash: passwordHash,
          role: 'owner'
        }
      });

      const platform = await tx.platforms.create({
        data: {
          name: platform_name,
          slug: platformSlug,
          owner_id: owner.id,
          domain: domain || null,
          description: description || null,
          is_active: true
        }
      });

      await tx.customers.update({
        where: { id: owner.id },
        data: { platform_id: platform.id, role: 'owner' }
      });

      await seedDefaultPlans(tx, platform.id);

      return { owner, platform };
    });

    const token = issueCustomerToken({
      id: result.owner.id,
      platform_id: result.platform.id,
      role: 'owner'
    });

    return res.status(201).json({
      platform: result.platform,
      owner: {
        id: result.owner.id,
        email: result.owner.email,
        name: result.owner.name,
        role: 'owner',
        platform_id: result.platform.id
      },
      token
    });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Email or platform slug already exists' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Platform owner registration failed' });
  }
});

// POST /v1/platforms (create platform from existing authenticated user)
router.post('/', requireCustomer, async (req, res) => {
  const { name, slug, domain, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  if (req.customer.platform_id) {
    return res.status(409).json({
      error: 'Customer already belongs to a platform. Use /v1/platforms/register for new owner bootstrap.'
    });
  }

  const platformSlug = toSlug(slug || name);
  if (!platformSlug) return res.status(400).json({ error: 'Invalid platform slug' });

  try {
    const created = await prisma.$transaction(async (tx) => {
      const platform = await tx.platforms.create({
        data: {
          name,
          slug: platformSlug,
          owner_id: req.customer.id,
          domain: domain || null,
          description: description || null,
          is_active: true
        }
      });

      await tx.customers.update({
        where: { id: req.customer.id },
        data: { platform_id: platform.id, role: 'owner' }
      });

      await seedDefaultPlans(tx, platform.id);
      return platform;
    });

    return res.status(201).json(created);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Platform slug already exists' });
    console.error(err);
    return res.status(500).json({ error: 'Platform creation failed' });
  }
});

module.exports = router;
