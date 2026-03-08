const express = require('express');
const pool = require('../db/pool');
const { requireCustomer } = require('../middleware/auth');
const { fireWebhookEvent } = require('../services/webhook');

const router = express.Router();

// POST /billing/run-invoice - generate invoice for current period
router.post('/run-invoice', requireCustomer, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get active subscription + plan
    const { rows: subs } = await client.query(
      `SELECT s.*, p.name as plan_name, p.price_cents, p.monthly_quota
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.customer_id = $1 AND s.status = 'active'
       ORDER BY s.created_at DESC LIMIT 1`,
      [req.customer.id]
    );

    if (!subs.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No active subscription' });
    }

    const sub = subs[0];

    // Check for existing invoice this period (prevent duplicates)
    const { rows: existing } = await client.query(
      `SELECT id FROM invoices
       WHERE customer_id = $1
         AND subscription_id = $2
         AND period_start = $3
         AND status != 'void'`,
      [req.customer.id, sub.id, sub.current_period_start]
    );
    if (existing.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Invoice already exists for this period', invoice_id: existing[0].id });
    }

    // Get usage this month
    const yearMonth = new Date(sub.current_period_start).toISOString().slice(0, 7);
    const { rows: usage } = await client.query(
      `SELECT COALESCE(SUM(um.count), 0) as total_requests
       FROM api_keys ak
       LEFT JOIN usage_monthly um ON um.api_key_id = ak.id AND um.year_month = $1
       WHERE ak.customer_id = $2`,
      [yearMonth, req.customer.id]
    );

    const totalRequests = parseInt(usage[0].total_requests);
    const overage = Math.max(0, totalRequests - sub.monthly_quota);
    const overageRate = 1; // $0.01 per extra request = 1 cent
    const overageCents = overage * overageRate;
    const totalCents = sub.price_cents + overageCents;

    // Create invoice
    const { rows: invoiceRows } = await client.query(
      `INSERT INTO invoices (customer_id, subscription_id, status, total_cents, period_start, period_end, issued_at)
       VALUES ($1, $2, 'issued', $3, $4, $5, NOW())
       RETURNING *`,
      [req.customer.id, sub.id, totalCents, sub.current_period_start, sub.current_period_end]
    );

    const invoice = invoiceRows[0];

    // Create invoice items
    await client.query(
      `INSERT INTO invoice_items (invoice_id, description, quantity, unit_cents, total_cents)
       VALUES ($1, $2, 1, $3, $3)`,
      [invoice.id, `${sub.plan_name} plan - ${yearMonth}`, sub.price_cents]
    );

    if (overage > 0) {
      await client.query(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_cents, total_cents)
         VALUES ($1, $2, $3, $4, $5)`,
        [invoice.id, `Overage: ${overage} extra requests @ $0.01 each`, overage, overageRate, overageCents]
      );
    }

    await client.query('COMMIT');

    // Fire webhook (non-blocking)
    fireWebhookEvent(req.customer.id, 'invoice.issued', {
      invoice_id: invoice.id,
      total_cents: totalCents,
      period: yearMonth
    }).catch(console.error);

    res.status(201).json({
      invoice,
      items: [
        { description: `${sub.plan_name} plan`, amount_cents: sub.price_cents },
        ...(overage > 0 ? [{ description: `Overage (${overage} req)`, amount_cents: overageCents }] : [])
      ],
      total_cents: totalCents,
      total_usd: (totalCents / 100).toFixed(2)
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Invoice generation failed' });
  } finally {
    client.release();
  }
});

// GET /billing/invoices - list my invoices
router.get('/invoices', requireCustomer, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT i.*, 
       json_agg(ii.*) as items
     FROM invoices i
     LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
     WHERE i.customer_id = $1
     GROUP BY i.id
     ORDER BY i.created_at DESC`,
    [req.customer.id]
  );
  res.json(rows);
});

module.exports = router;
