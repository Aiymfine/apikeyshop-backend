# API_SPEC.md — APIKeyShop

Base URL: `http://localhost:8082/v1`

---

## Auth

### POST /v1/auth/register
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

### POST /v1/auth/login
**Body:** `{ "email": "...", "password": "..." }`
**Response 200:** `{ "customer": {...}, "token": "..." }`

---

## Plans

### GET /v1/plans
**Response 200:**
```json
[
  { "id": 1, "name": "Free", "req_per_min": 3, "monthly_quota": 1000, "price_cents": 0 },
  { "id": 2, "name": "Starter", "req_per_min": 60, "monthly_quota": 50000, "price_cents": 999 },
  { "id": 3, "name": "Pro", "req_per_min": 300, "monthly_quota": 500000, "price_cents": 4999 }
]
```

### POST /v1/plans/subscribe
**Auth:** Bearer token
**Body:** `{ "plan_id": 2 }`
**Response 201:** `{ "subscription": {...}, "plan": {...} }`

### GET /v1/plans/me
**Auth:** Bearer token
**Response 200:** `{ "id": 1, "status": "active", "plans": {...} }`

---

## API Keys

### POST /v1/api-keys
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

### GET /v1/api-keys
**Auth:** Bearer token
**Response 200:** Array of keys (no secrets, prefix only)

### DELETE /v1/api-keys/:id
**Auth:** Bearer token
**Response 200:** `{ "message": "Key revoked", "key": {...} }`

---

## Protected API

### GET /v1/data
**Auth:** `X-Api-Key: <full_key>`
**Response Headers:**
```
X-RateLimit-Limit: 3
X-RateLimit-Remaining: 2
X-Quota-Limit: 1000
X-Quota-Remaining: 999
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
{ "error": "Rate limit exceeded", "limit": 3, "window": "1 minute" }
```
**Response 429 (quota):**
```json
{ "error": "Monthly quota exceeded", "quota": 1000, "used": 1000 }
```

### GET /v1/usage/me
**Auth:** `X-Api-Key`
**Response 200:**
```json
{
  "plan": { "name": "Free", "req_per_min": 3, "monthly_quota": 1000 },
  "current_month": "2026-03",
  "monthly_used": 7,
  "monthly_quota": 1000,
  "daily_breakdown": [{ "date": "2026-03-19", "count": 7 }]
}
```

---

## Billing

### POST /v1/billing/run-invoice
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
**Response 409 (duplicate):**
```json
{ "error": "Invoice already exists for this period", "invoice_id": 1 }
```

### GET /v1/billing/invoices
**Auth:** Bearer token
**Response 200:** Array of invoices with items

---

## Webhooks

### POST /v1/webhooks
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

### GET /v1/webhooks
**Auth:** Bearer token
**Response 200:** Array of webhook endpoints (no secrets)

### POST /v1/webhooks/test-fire
**Auth:** Bearer token
**Body:** `{ "event_type": "invoice.issued", "payload": {} }`
**Response 200:** `{ "message": "Event queued for delivery" }`

### GET /v1/webhooks/attempts
**Auth:** Bearer token
**Response 200:** Array of delivery attempts with retry status

---

## Error Responses

| Code | Meaning |
|------|---------|
| 400 | Bad request / missing fields |
| 401 | Missing or invalid auth |
| 403 | Forbidden (no subscription, etc.) |
| 404 | Resource not found |
| 409 | Conflict (duplicate invoice, existing email) |
| 429 | Rate limited or quota exceeded |
| 500 | Server error |

---

## Security Design

### API Key Storage (Stripe-style)
1. Generate: `ak_<prefix6bytes>_<secret24bytes>`
2. Store: `key_prefix` (plain) + `key_hash` (bcrypt)
3. Lookup: find by prefix → bcrypt.compare(raw, hash)
4. **Raw key shown exactly once** at creation

### Rolling Window Rate Limiting
- Uses `usage_counters` table with 1-minute windows
- Atomic SQL upsert — no race conditions
- Returns `X-RateLimit-Remaining` header

### Quota Enforcement
- `usage_monthly` atomically incremented per request
- Request denied with 429 if `count > monthly_quota`

### Webhook HMAC Signing
- Each endpoint has its own secret
- Payload signed: `HMAC-SHA256(secret, timestamp.body)`
- Header: `X-Webhook-Signature: t=<ts>,v1=<sig>`

### Retry Backoff Schedule
| Attempt | Delay |
|---------|-------|
| 1 | 1 min |
| 2 | 5 min |
| 3 | 15 min |
| 4 | 60 min |
| 5 | 180 min → exhausted |