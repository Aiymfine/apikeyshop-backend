const express = require('express');
const prisma = require('../db/prisma');
const { requireCustomer } = require('../middleware/auth');
const { fireWebhookEvent } = require('../services/webhook');
const { sendEmail } = require('../services/email');

const router = express.Router();

// POST /billing/run-invoice
router.post('/run-invoice', requireCustomer, async (req, res) => {
  try {
    const subscription = await prisma.subscriptions.findFirst({
      where: {
        customer_id: req.customer.id,
        platform_id: req.customer.platform_id,
        status: 'active'
      },
      orderBy: { created_at: 'desc' },
      include: { plans: true }
    });

    if (!subscription)
      return res.status(404).json({ error: 'No active subscription' });

    // Check duplicate invoice
    const existing = await prisma.invoices.findFirst({
      where: {
        customer_id: req.customer.id,
        platform_id: req.customer.platform_id,
        subscription_id: subscription.id,
        period_start: subscription.current_period_start,
        NOT: { status: 'void' }
      }
    });

    if (existing)
      return res.status(409).json({
        error: 'Invoice already exists for this period',
        invoice_id: existing.id
      });

    // Get usage this month
    const yearMonth = new Date(subscription.current_period_start)
      .toISOString().slice(0, 7);

    const apiKeys = await prisma.api_keys.findMany({
      where: {
        customer_id: req.customer.id,
        platform_id: req.customer.platform_id
      },
      include: {
        usage_monthly: {
          where: { year_month: yearMonth }
        }
      }
    });

    const totalRequests = apiKeys.reduce((sum, key) => {
      return sum + (key.usage_monthly[0]?.count || 0);
    }, 0);

    const overage = Math.max(0, totalRequests - subscription.plans.monthly_quota);
    const overageRate = 1;
    const overageCents = overage * overageRate;
    const totalCents = subscription.plans.price_cents + overageCents;

    // Create invoice + items in transaction
    const invoice = await prisma.$transaction(async (tx) => {
      const newInvoice = await tx.invoices.create({
        data: {
          customer_id: req.customer.id,
          platform_id: req.customer.platform_id,
          subscription_id: subscription.id,
          status: 'issued',
          total_cents: totalCents,
          period_start: subscription.current_period_start,
          period_end: subscription.current_period_end,
          issued_at: new Date()
        }
      });

      await tx.invoice_items.create({
        data: {
          invoice_id: newInvoice.id,
          description: `${subscription.plans.name} plan - ${yearMonth}`,
          quantity: 1,
          unit_cents: subscription.plans.price_cents,
          total_cents: subscription.plans.price_cents
        }
      });

      if (overage > 0) {
        await tx.invoice_items.create({
          data: {
            invoice_id: newInvoice.id,
            description: `Overage: ${overage} extra requests @ $0.01 each`,
            quantity: overage,
            unit_cents: overageRate,
            total_cents: overageCents
          }
        });
      }

      return newInvoice;
    });

    // Fire webhook
    fireWebhookEvent(req.customer.id, req.customer.platform_id, 'invoice.issued', {
      invoice_id: invoice.id,
      total_cents: totalCents,
      period: yearMonth
    }).catch(console.error);

    sendEmail({
      to: req.customer.email,
      subject: `Invoice issued #${invoice.id}`,
      text: `Your invoice for ${yearMonth} is issued. Total: $${(totalCents / 100).toFixed(2)}`
    }).catch(console.error);

    res.status(201).json({
      invoice,
      items: [
        { description: `${subscription.plans.name} plan`, amount_cents: subscription.plans.price_cents },
        ...(overage > 0 ? [{ description: `Overage (${overage} req)`, amount_cents: overageCents }] : [])
      ],
      total_cents: totalCents,
      total_usd: (totalCents / 100).toFixed(2)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Invoice generation failed' });
  }
});

// GET /billing/invoices
router.get('/invoices', requireCustomer, async (req, res) => {
  const invoices = await prisma.invoices.findMany({
    where: {
      customer_id: req.customer.id,
      platform_id: req.customer.platform_id
    },
    include: { invoice_items: true },
    orderBy: { created_at: 'desc' }
  });
  res.json(invoices);
});

module.exports = router;