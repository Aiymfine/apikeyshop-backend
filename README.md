# APIKeyShop — API Monetization & Billing Backend

## Stack
- **Runtime**: Node.js + Express
- **Database**: PostgreSQL
- **Security**: bcrypt key hashing, HMAC-SHA256 webhook signing, timing-safe comparisons

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your Postgres connection string
```

### 3. Run migrations
```bash
npm run migrate
```

### 4. Start server
```bash
npm run dev   # development (nodemon)
npm start     # production
```

---

## Authentication

Customer auth uses `Bearer base64(email:password)` for simplicity.

Get your token from `POST /auth/register` or `POST /auth/login`, then:
```
Authorization: Bearer <token>
```

API key auth uses:
```
X-Api-Key: ak_xxxxxx_yyyyyyyy...
```

---

## Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Register new customer |
| POST | `/auth/login` | Get auth token |

### Plans
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/plans` | — | List all plans |
| POST | `/plans` | — | Create plan (admin) |
| POST | `/plans/subscribe` | Bearer | Subscribe to a plan |
| GET | `/plans/me` | Bearer | My current subscription |

### API Keys
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api-keys` | Bearer | Issue new key (shown ONCE) |
| GET | `/api-keys` | Bearer | List my keys (no secrets) |
| DELETE | `/api-keys/:id` | Bearer | Revoke a key |

### Protected API
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/data` | X-Api-Key | Sample protected endpoint |
| GET | `/v1/usage/me` | X-Api-Key | My usage stats |

### Billing
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/billing/run-invoice` | Bearer | Generate invoice for current period |
| GET | `/billing/invoices` | Bearer | List my invoices |

### Webhooks
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/webhooks` | Bearer | Register webhook endpoint |
| GET | `/webhooks` | Bearer | List my endpoints |
| POST | `/webhooks/test-fire` | Bearer | Fire test event |
| GET | `/webhooks/attempts` | Bearer | View delivery history |

---

## Security Design

### API Key Storage (Stripe-style)
1. Generate: `ak_<prefix6bytes>_<secret24bytes>`
2. Store: `key_prefix` (plain) + `key_hash` (bcrypt)
3. Lookup: find by prefix → bcrypt.compare(raw, hash)
4. **Raw key shown exactly once** at creation

### Rolling Window Rate Limiting
- Uses `usage_counters` table with 1-minute windows
- `INSERT ... ON CONFLICT DO UPDATE` is atomic — no race conditions
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
