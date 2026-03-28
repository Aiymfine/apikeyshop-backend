require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { processRetryQueue } = require('./services/webhook');
const prisma = require('./db/prisma');

const app = express();
app.use(express.json());

// ─── Routes (all under /v1) ───────────────────────────────────────────────────
app.use('/v1/auth',      require('./routes/auth'));
app.use('/v1/platforms', require('./routes/platforms'));
app.use('/v1/plans',     require('./routes/plans'));
app.use('/v1/subscribe', require('./routes/plans'));
app.use('/v1/api-keys',  require('./routes/apikeys'));
app.use('/v1',           require('./routes/v1'));
app.use('/v1/billing',   require('./routes/billing'));
app.use('/v1/webhooks',  require('./routes/webhooks'));
app.use('/v1/admin',     require('./routes/admin'));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: `Route ${req.method} ${req.path} not found` }));

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Cron: process webhook retry queue every minute ──────────────────────────
cron.schedule('* * * * *', () => {
  console.log('[cron] Processing webhook retry queue...');
  processRetryQueue();
});

// ─── Cron: check expired subscriptions daily at midnight ─────────────────────
cron.schedule('0 0 * * *', async () => {
  console.log('[cron] Checking expired subscriptions...');
  const expired = await prisma.subscriptions.updateMany({
    where: {
      status: 'active',
      current_period_end: { lt: new Date() }
    },
    data: { status: 'past_due' }
  });
  console.log(`[cron] Marked ${expired.count} subscriptions as past_due`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 APIKeyShop running on port ${PORT}`);
  console.log(`📋 Routes:`);
  console.log(`   POST /v1/auth/register`);
  console.log(`   POST /v1/auth/login`);
  console.log(`   POST /v1/platforms/register`);
  console.log(`   POST /v1/platforms`);
  console.log(`   GET  /v1/plans`);
  console.log(`   POST /v1/plans/subscribe`);
  console.log(`   POST /v1/api-keys`);
  console.log(`   DELETE /v1/api-keys/:id`);
  console.log(`   GET  /v1/data`);
  console.log(`   GET  /v1/usage/me`);
  console.log(`   POST /v1/billing/run-invoice`);
  console.log(`   GET  /v1/billing/invoices`);
  console.log(`   POST /v1/webhooks`);
  console.log(`   POST /v1/webhooks/test-fire`);
  console.log(`   GET  /v1/webhooks/attempts`);
  console.log(`   GET  /v1/admin/customers`);
  console.log(`   GET  /v1/admin/revenue`);
  console.log(`   GET  /v1/admin/usage\n`);
});