-- Multi-tenant + auth + feature upgrades for existing DBs.

CREATE TABLE IF NOT EXISTS platforms (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  owner_id    INT NOT NULL,
  domain      TEXT,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platforms_owner_id ON platforms(owner_id);

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS platform_id INT REFERENCES platforms(id),
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'customer';

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS platform_id INT REFERENCES platforms(id);
CREATE INDEX IF NOT EXISTS idx_plans_platform_id ON plans(platform_id);

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS platform_id INT REFERENCES platforms(id);
CREATE INDEX IF NOT EXISTS idx_api_keys_platform_id ON api_keys(platform_id);

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS platform_id INT REFERENCES platforms(id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_platform_id ON subscriptions(platform_id);

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS platform_id INT REFERENCES platforms(id);

ALTER TABLE webhook_endpoints
  ADD COLUMN IF NOT EXISTS platform_id INT REFERENCES platforms(id);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_platform_id ON webhook_endpoints(platform_id);
