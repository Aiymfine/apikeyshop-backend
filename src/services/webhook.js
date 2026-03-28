const crypto = require('crypto');
const prisma = require('../db/prisma');
const { sendEmail } = require('./email');

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

// Send webhook over HTTP with HMAC signature headers.
async function sendWebhook(endpoint, eventType, payload) {
  const { signature, body } = signPayload(endpoint.secret, payload);
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is not available in this Node runtime');
  }

  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Event': eventType
      },
      body
    });

    const responseText = await response.text();
    return {
      success: response.ok,
      status: response.status,
      response: responseText || response.statusText
    };
  } catch (err) {
    return {
      success: false,
      status: 0,
      response: err.message || 'Network error'
    };
  }
}

// Fire event to all matching endpoints
async function fireWebhookEvent(customerId, platformId, eventType, payload) {
  const endpoints = await prisma.webhook_endpoints.findMany({
    where: {
      customer_id: customerId,
      platform_id: platformId,
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
        select: { url: true, secret: true, customer_id: true }
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

    if (newStatus === 'exhausted') {
      const endpointOwner = await prisma.customers.findFirst({
        where: { id: attempt.webhook_endpoints.customer_id }
      });

      if (endpointOwner?.email) {
        await sendEmail({
          to: endpointOwner.email,
          subject: `Webhook delivery exhausted: ${attempt.event_type}`,
          text: `Webhook delivery to ${attempt.webhook_endpoints.url} exhausted retry attempts for event ${attempt.event_type}.`
        });
      }
    }

    console.log(`Webhook attempt #${newAttemptCount} for [${attempt.event_type}]: ${newStatus}`);
  }
}

module.exports = { fireWebhookEvent, processRetryQueue, signPayload };