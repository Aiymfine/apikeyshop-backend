# API_SPEC.md — APIKeyShop

Base URL: `http://localhost:3000`

---

## Auth

### POST /auth/register
**Body:**
```json
{ "email": "user@example.com", "name": "Alice", "password": "secret123" }
```
**Response 201:**
```json
{
  "customer": { "id": 1, "email": "user@example.com", "name": "Alice" },
  "token": "dXNlckBleGFtcGxlLmNvbTpzZWNyZXQxMjM=",
  "message": "Registered and subscribed to Free plan"
}
```

### POST /auth/login
**Body:** `{ "email": "...", "password": "..." }`
**Response 200:** `{ "customer": {...}, "token": "..." }`

---

## Plans

### GET /plans
**Response 200:**
```json
[
  { "id": 1, "name": "Free", "req_per_min": 10, "monthly_quota": 1000, "price_cents": 0 },
  { "id": 2, "name": "Starter", "req_per_min": 60, "monthly_quota": 50000, "price_cents": 999 },
  { "id": 3, "name": "Pro", "req_per_min": 300, "monthly_quota": 500000, "price_cents": 4999 }
]
```

### POST /plans/subscribe
**Auth:** Bearer token
**Body:** `{ "plan_id": 2 }`
**Response 201:** `{ "subscription": {...}, "plan": {...} }`

---

## API Keys

### POST /api-keys
**Auth:** Bearer token
**Body (optional):** `{ "name": "Production Key" }`
**Response 201:**
```json
{
  "id": 1,
  "key_prefix": "ak_a1b2c3",
  "name": "Production Key",
  "status": "active",
  "raw_key": "ak_a1b2c3_d4e5f6...",
  "warning": "This is the only time your full API key will be shown. Store it now."
}
```
> ⚠️ `raw_key` is shown ONCE. It is not stored and cannot be retrieved.

### GET /api-keys
**Auth:** Bearer token
**Response 200:** Array of keys (no secrets, prefix only)

### DELETE /api-keys/:id
**Auth:** Bearer token
**Response 200:** `{ "message": "Key revoked", "key": {...} }`

---

## Protected API

### GET /v1/data
**Auth:** `X-Api-Key: <full_key>`
**Response Headers:**
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 59
X-Quota-Limit: 50000
X-Quota-Remaining: 49950
```
**Response 200:**
```json
{
  "message": "Here is your protected data ✅",
  "key_prefix": "ak_a1b2c3",
  "sample_data": { "records": [...] }
}
```
**Response 429 (rate limit):**
```json
{ "error": "Rate limit exceeded", "limit": 60, "window": "1 minute" }
```
**Response 429 (quota):**
```json
{ "error": "Monthly quota exceeded", "quota": 50000, "used": 50000 }
```

### GET /v1/usage/me
**Auth:** `X-Api-Key`
**Response 200:**
```json
{
  "plan": { "name": "Starter", "req_per_min": 60, "monthly_quota": 50000 },
  "current_month": "2024-03",
  "monthly_used": 1234,
  "monthly_quota": 50000,
  "daily_breakdown": [{ "date": "2024-03-15", "count": 120 }]
}
```

---

## Billing

### POST /billing/run-invoice
**Auth:** Bearer token
**Response 201:**
```json
{
  "invoice": { "id": 1, "status": "issued", "total_cents": 999 },
  "items": [
    { "description": "Starter plan", "amount_cents": 999 }
  ],
  "total_cents": 999,
  "total_usd": "9.99"
}
```

### GET /billing/invoices
**Auth:** Bearer token
**Response 200:** Array of invoices with items

---

## Webhooks

### POST /webhooks
**Auth:** Bearer token
**Body:**
```json
{ "url": "https://yoursite.com/hook", "events": ["invoice.issued", "key.revoked"] }
```
**Response 201:**
```json
{
  "id": 1,
  "url": "https://yoursite.com/hook",
  "signing_secret": "abc123...",
  "warning": "Store your signing secret securely. It will not be shown again."
}
```

### POST /webhooks/test-fire
**Auth:** Bearer token
**Body:** `{ "event_type": "invoice.issued", "payload": {} }`

### GET /webhooks/attempts
**Auth:** Bearer token
**Response 200:** Array of delivery attempts with status, retry count, next_retry_at

---

## Error Responses

| Code | Meaning |
|------|---------|
| 400 | Bad request / missing fields |
| 401 | Missing or invalid auth |
| 403 | Forbidden (no subscription, etc.) |
| 404 | Resource not found |
| 409 | Conflict (duplicate invoice, etc.) |
| 429 | Rate limited or quota exceeded |
| 500 | Server error |
