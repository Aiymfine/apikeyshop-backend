const crypto = require('crypto');
const prisma = require('../db/prisma');

// Sign payload with HMAC-SHA256
function signPayload(secret, payload) {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(payload);
  const signed = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return { signature: `t=${timestamp},v1=${signed}`, body };
}

// Simulate sending webhook
async function sendWebhook(endpoint, eventType, payload) {
  const { signature, body } = signPayload(endpoint.secret, payload);
  const simulateSuccess = Math.random() > 0.3;

  return {
    success: simulateSuccess,
    status: simulateSuccess ? 200 : 500,
    response: simulateSuccess ? 'OK' : 'Simulated server error',
    headers_sent: { 'X-Webhook-Signature': signature }
  };
}

// Fire event to all matching endpoints
async function fireWebhookEvent(customerId, eventType, payload) {
  const endpoints = await prisma.webhook_endpoints.findMany({
    where: {
      customer_id: customerId,
      is_active: true
    }
  });

  const matchingEndpoints = endpoints.filter(ep =>
    ep.events.length === 0 || ep.events.includes(eventType)
  );

  for (const endpoint of matchingEndpoints) {
    await prisma.webhook_attempts.create({
      data: {
        endpoint_id: endpoint.id,
        event_type: eventType,
        payload: payload,
        status: 'pending',
        next_retry_at: new Date()
      }
    });
  }
}

// Retry worker
const MAX_ATTEMPTS = 5;
const BACKOFF_MINUTES = [1, 5, 15, 60, 180];

async function processRetryQueue() {
  const attempts = await prisma.webhook_attempts.findMany({
    where: {
      status: { in: ['pending', 'failed'] },
      next_retry_at: { lte: new Date() },
      attempt_count: { lt: MAX_ATTEMPTS }
    },
    include: {
      webhook_endpoints: {
        select: { url: true, secret: true }
      }
    },
    take: 10
  });

  for (const attempt of attempts) {
    const result = await sendWebhook(
      {
        url: attempt.webhook_endpoints.url,
        secret: attempt.webhook_endpoints.secret
      },
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

    await prisma.webhook_attempts.update({
      where: { id: attempt.id },
      data: {
        status: newStatus,
        attempt_count: newAttemptCount,
        next_retry_at: nextRetry,
        last_response: result.response,
        last_attempted_at: new Date()
      }
    });

    console.log(`Webhook attempt #${newAttemptCount} for [${attempt.event_type}]: ${newStatus}`);
  }
}

module.exports = { fireWebhookEvent, processRetryQueue, signPayload };