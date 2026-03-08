const crypto = require('crypto');
const pool = require('../db/pool');

// ─── Sign a payload with HMAC-SHA256 (like Stripe does) ──────────────────────
function signPayload(secret, payload) {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(payload);
  const signed = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return { signature: `t=${timestamp},v1=${signed}`, body };
}

// ─── Simulate sending a webhook (in real app this calls fetch/axios) ──────────
async function sendWebhook(endpoint, eventType, payload) {
  const { signature, body } = signPayload(endpoint.secret, payload);

  // Simulate HTTP call - in production use: await fetch(endpoint.url, ...)
  // For midterm: we simulate success/failure randomly to test retry
  const simulateSuccess = Math.random() > 0.3; // 70% success rate

  return {
    success: simulateSuccess,
    status: simulateSuccess ? 200 : 500,
    response: simulateSuccess ? 'OK' : 'Simulated server error',
    headers_sent: { 'X-Webhook-Signature': signature }
  };
}

// ─── Fire event to all matching webhook endpoints for a customer ──────────────
async function fireWebhookEvent(customerId, eventType, payload) {
  const { rows: endpoints } = await pool.query(
    `SELECT * FROM webhook_endpoints
     WHERE customer_id = $1 AND is_active = true
       AND (events = '{}' OR $2 = ANY(events))`,
    [customerId, eventType]
  );

  for (const endpoint of endpoints) {
    await pool.query(
      `INSERT INTO webhook_attempts (endpoint_id, event_type, payload, status, next_retry_at)
       VALUES ($1, $2, $3, 'pending', NOW())`,
      [endpoint.id, eventType, JSON.stringify(payload)]
    );
  }
}

// ─── Retry worker: called by cron job ────────────────────────────────────────
const MAX_ATTEMPTS = 5;
const BACKOFF_MINUTES = [1, 5, 15, 60, 180]; // exponential-ish backoff

async function processRetryQueue() {
  const client = await pool.connect();
  try {
    // Grab pending attempts that are due
    const { rows: attempts } = await client.query(
      `SELECT wa.*, we.url, we.secret
       FROM webhook_attempts wa
       JOIN webhook_endpoints we ON we.id = wa.endpoint_id
       WHERE wa.status IN ('pending', 'failed')
         AND wa.next_retry_at <= NOW()
         AND wa.attempt_count < $1
       LIMIT 10`,
      [MAX_ATTEMPTS]
    );

    for (const attempt of attempts) {
      const result = await sendWebhook(
        { url: attempt.url, secret: attempt.secret },
        attempt.event_type,
        attempt.payload
      );

      const newAttemptCount = attempt.attempt_count + 1;
      const isExhausted = newAttemptCount >= MAX_ATTEMPTS;

      let newStatus, nextRetry;
      if (result.success) {
        newStatus = 'success';
        nextRetry = null;
      } else if (isExhausted) {
        newStatus = 'exhausted';
        nextRetry = null;
      } else {
        newStatus = 'failed';
        const backoffMins = BACKOFF_MINUTES[newAttemptCount - 1] || 180;
        nextRetry = new Date(Date.now() + backoffMins * 60 * 1000);
      }

      await client.query(
        `UPDATE webhook_attempts
         SET status = $1,
             attempt_count = $2,
             next_retry_at = $3,
             last_response = $4,
             last_attempted_at = NOW()
         WHERE id = $5`,
        [newStatus, newAttemptCount, nextRetry, result.response, attempt.id]
      );

      console.log(`Webhook attempt #${newAttemptCount} for [${attempt.event_type}]: ${newStatus}`);
    }
  } catch (err) {
    console.error('Retry queue error:', err);
  } finally {
    client.release();
  }
}

module.exports = { fireWebhookEvent, processRetryQueue, signPayload };
