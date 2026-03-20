require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { processRetryQueue } = require('./services/webhook');

const app = express();
app.use(express.json());

// ─── Routes (all under /v1) ───────────────────────────────────────────────────
app.use('/v1/auth',      require('./routes/auth'));
app.use('/v1/plans',     require('./routes/plans'));
app.use('/v1/subscribe', require('./routes/plans'));
app.use('/v1/api-keys',  require('./routes/apikeys'));
app.use('/v1',           require('./routes/v1'));
app.use('/v1/billing',   require('./routes/billing'));
app.use('/v1/webhooks',  require('./routes/webhooks'));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: `Route ${req.method} ${req.path} not found` }));

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Cron job ─────────────────────────────────────────────────────────────────
cron.schedule('* * * * *', () => {
  console.log('[cron] Processing webhook retry queue...');
  processRetryQueue();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 APIKeyShop running on port ${PORT}`);
  console.log(`📋 Routes:`);
  console.log(`   POST /v1/auth/register`);
  console.log(`   POST /v1/auth/login`);
  console.log(`   GET  /v1/plans`);
  console.log(`   POST /v1/plans/subscribe`);
  console.log(`   POST /v1/api-keys`);
  console.log(`   DELETE /v1/api-keys/:id`);
  console.log(`   GET  /v1/data`);
  console.log(`   GET  /v1/usage/me`);
  console.log(`   POST /v1/billing/run-invoice`);
  console.log(`   GET  /v1/billing/invoices`);
  console.log(`   POST /v1/webhooks/test-fire`);
  console.log(`   GET  /v1/webhooks/attempts\n`);
});

