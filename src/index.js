require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { processRetryQueue } = require('./services/webhook');

const app = express();
app.use(express.json());

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/auth',      require('./routes/auth'));
app.use('/plans',     require('./routes/plans'));
app.use('/subscribe', require('./routes/plans'));   // alias
app.use('/api-keys',  require('./routes/apikeys'));
app.use('/v1',        require('./routes/v1'));
app.use('/billing',   require('./routes/billing'));
app.use('/webhooks',  require('./routes/webhooks'));

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 APIKeyShop running on port ${PORT}`);
  console.log(`📋 Routes:`);
  console.log(`   POST /auth/register`);
  console.log(`   POST /auth/login`);
  console.log(`   GET  /plans`);
  console.log(`   POST /plans/subscribe`);
  console.log(`   POST /api-keys`);
  console.log(`   DELETE /api-keys/:id`);
  console.log(`   GET  /v1/data          ← requires X-Api-Key`);
  console.log(`   GET  /v1/usage/me      ← requires X-Api-Key`);
  console.log(`   POST /billing/run-invoice`);
  console.log(`   GET  /billing/invoices`);
  console.log(`   POST /webhooks/test-fire`);
  console.log(`   GET  /webhooks/attempts\n`);
});
