

-- 1. CUSTOMERS
CREATE TABLE IF NOT EXISTS customers (
  id          SERIAL PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. PLANS
CREATE TABLE IF NOT EXISTS plans (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  req_per_min     INT NOT NULL,          -- rate limit
  monthly_quota   INT NOT NULL,          -- total requests/month
  price_cents     INT NOT NULL,          -- e.g. 999 = $9.99
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default plans
INSERT INTO plans (name, req_per_min, monthly_quota, price_cents) VALUES
  ('Free',       10,   1000,   0),
  ('Starter',    60,   50000,  999),
  ('Pro',        300,  500000, 4999)
ON CONFLICT DO NOTHING;

-- 3. SUBSCRIPTIONS
CREATE TABLE IF NOT EXISTS subscriptions (
  id                SERIAL PRIMARY KEY,
  customer_id       INT NOT NULL REFERENCES customers(id),
  plan_id           INT NOT NULL REFERENCES plans(id),
  status            TEXT NOT NULL DEFAULT 'active',   -- active | cancelled | past_due
  current_period_start TIMESTAMPTZ DEFAULT NOW(),
  current_period_end   TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- 4. API KEYS
CREATE TABLE IF NOT EXISTS api_keys (
  id            SERIAL PRIMARY KEY,
  customer_id   INT NOT NULL REFERENCES customers(id),
  key_prefix    TEXT NOT NULL,          -- e.g. "ak_live_aBcD" (visible)
  key_hash      TEXT NOT NULL,          -- bcrypt hash of full key (never shown again)
  name          TEXT,                   -- optional label e.g. "Production Key"
  status        TEXT NOT NULL DEFAULT 'active',  -- active | revoked
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);

-- 5. USAGE COUNTERS (rolling 1-minute windows)
CREATE TABLE IF NOT EXISTS usage_counters (
  id                SERIAL PRIMARY KEY,
  api_key_id        INT NOT NULL REFERENCES api_keys(id),
  window_start      TIMESTAMPTZ NOT NULL,   -- truncated to the minute
  count             INT NOT NULL DEFAULT 0,
  UNIQUE (api_key_id, window_start)
);

-- 6. USAGE DAILY (aggregated)
CREATE TABLE IF NOT EXISTS usage_daily (
  id          SERIAL PRIMARY KEY,
  api_key_id  INT NOT NULL REFERENCES api_keys(id),
  date        DATE NOT NULL,
  count       INT NOT NULL DEFAULT 0,
  UNIQUE (api_key_id, date)
);

-- 7. USAGE MONTHLY (aggregated - used for quota checks)
CREATE TABLE IF NOT EXISTS usage_monthly (
  id          SERIAL PRIMARY KEY,
  api_key_id  INT NOT NULL REFERENCES api_keys(id),
  year_month  TEXT NOT NULL,  -- e.g. "2024-03"
  count       INT NOT NULL DEFAULT 0,
  UNIQUE (api_key_id, year_month)
);

-- 8. INVOICES
CREATE TABLE IF NOT EXISTS invoices (
  id              SERIAL PRIMARY KEY,
  customer_id     INT NOT NULL REFERENCES customers(id),
  subscription_id INT REFERENCES subscriptions(id),
  status          TEXT NOT NULL DEFAULT 'draft',  -- draft | issued | paid | void
  total_cents     INT NOT NULL DEFAULT 0,
  period_start    TIMESTAMPTZ,
  period_end      TIMESTAMPTZ,
  issued_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 9. INVOICE ITEMS
CREATE TABLE IF NOT EXISTS invoice_items (
  id          SERIAL PRIMARY KEY,
  invoice_id  INT NOT NULL REFERENCES invoices(id),
  description TEXT NOT NULL,
  quantity    INT NOT NULL DEFAULT 1,
  unit_cents  INT NOT NULL,
  total_cents INT NOT NULL
);

-- 10. WEBHOOK ENDPOINTS
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id          SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id),
  url         TEXT NOT NULL,
  secret      TEXT NOT NULL,    -- used to sign payloads (HMAC-SHA256)
  events      TEXT[] NOT NULL DEFAULT '{}',  -- e.g. ['invoice.issued', 'key.revoked']
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 11. WEBHOOK ATTEMPTS (retry table)
CREATE TABLE IF NOT EXISTS webhook_attempts (
  id              SERIAL PRIMARY KEY,
  endpoint_id     INT NOT NULL REFERENCES webhook_endpoints(id),
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | success | failed | exhausted
  attempt_count   INT NOT NULL DEFAULT 0,
  next_retry_at   TIMESTAMPTZ DEFAULT NOW(),
  last_response   TEXT,
  last_attempted_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_attempts_retry ON webhook_attempts(status, next_retry_at);
