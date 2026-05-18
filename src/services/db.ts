import { Pool } from 'pg';
import { config } from '../config';
import { logger } from './logger';

let pool: Pool | null = null;

const SCHEMA = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  -- ═══════════════════════════════════════════════════════════
  -- ZeroAuth Platform Schema
  -- Hosted API model: tenants → api_keys → usage_logs
  -- ═══════════════════════════════════════════════════════════

  -- Leads (marketing)
  CREATE TABLE IF NOT EXISTS leads (
    id SERIAL PRIMARY KEY,
    type VARCHAR(20) NOT NULL CHECK (type IN ('pilot', 'whitepaper')),
    name VARCHAR(255),
    company VARCHAR(255),
    email VARCHAR(255) NOT NULL,
    size VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_leads_type ON leads(type);
  CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);

  -- ─── Tenants (developer accounts) ───────────────────────
  CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    company_name VARCHAR(255),
    plan VARCHAR(50) NOT NULL DEFAULT 'free'
      CHECK (plan IN ('free', 'starter', 'growth', 'enterprise')),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'suspended', 'deactivated')),
    -- Per-plan rate limits (requests per 15-minute window)
    rate_limit INT NOT NULL DEFAULT 100,
    -- Monthly quota (-1 = unlimited)
    monthly_quota INT NOT NULL DEFAULT 1000,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_tenants_email ON tenants(email);
  CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

  -- ─── Pending signups (F-2 v2: byte-identical /api/console/signup) ───
  -- Holds a hashed password + intended company name keyed by a single-use
  -- verification token. Created when POST /api/console/signup is called
  -- for a fresh email; consumed when the user clicks the verify link.
  -- Lifetime: 24h, after which the row is GC'd by a periodic cleanup
  -- (the consume path also rejects expired rows defensively).
  CREATE TABLE IF NOT EXISTS pending_signups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    company_name VARCHAR(255),
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    consumed_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS idx_pending_signups_token ON pending_signups(token_hash);
  CREATE INDEX IF NOT EXISTS idx_pending_signups_expires ON pending_signups(expires_at) WHERE consumed_at IS NULL;

  -- ─── API Keys ───────────────────────────────────────────
  -- Keys are prefixed: za_live_* (production) or za_test_* (sandbox)
  -- Only the SHA-256 hash is stored; the raw key is shown once at creation.
  CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL DEFAULT 'Default',
    -- Key prefix stored in plain text for identification (e.g. "za_live_a1b2c3")
    key_prefix VARCHAR(20) NOT NULL,
    -- SHA-256 hash of the full key
    key_hash VARCHAR(64) NOT NULL UNIQUE,
    -- Scoped permissions
    scopes TEXT[] NOT NULL DEFAULT ARRAY['zkp:verify', 'zkp:register', 'identity:read', 'nonce:create'],
    -- Environment
    environment VARCHAR(10) NOT NULL DEFAULT 'live'
      CHECK (environment IN ('live', 'test')),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'revoked')),
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
  CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
  CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status) WHERE status = 'active';

  -- ─── Usage Logs ─────────────────────────────────────────
  -- Append-only log for every API call, used for metering and billing.
  CREATE TABLE IF NOT EXISTS usage_logs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    endpoint VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,
    status_code INT,
    response_time_ms INT,
    ip_address INET,
    user_agent VARCHAR(512),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_usage_logs_tenant ON usage_logs(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_usage_logs_tenant_created ON usage_logs(tenant_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at DESC);

  -- ─── Monthly Usage Aggregates (materialized for billing) ─
  CREATE TABLE IF NOT EXISTS usage_monthly (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    month DATE NOT NULL,
    total_requests INT NOT NULL DEFAULT 0,
    zkp_verifications INT NOT NULL DEFAULT 0,
    zkp_registrations INT NOT NULL DEFAULT 0,
    saml_auths INT NOT NULL DEFAULT 0,
    oidc_auths INT NOT NULL DEFAULT 0,
    UNIQUE(tenant_id, month)
  );
  CREATE INDEX IF NOT EXISTS idx_usage_monthly_tenant ON usage_monthly(tenant_id, month DESC);

  -- ─── Devices ──────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    environment VARCHAR(10) NOT NULL
      CHECK (environment IN ('live', 'test')),
    external_id VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    location_id VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'inactive', 'retired')),
    battery_level INT CHECK (battery_level BETWEEN 0 AND 100),
    metadata JSONB NOT NULL DEFAULT '{}',
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, environment, external_id)
  );
  CREATE INDEX IF NOT EXISTS idx_devices_tenant ON devices(tenant_id, environment, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(tenant_id, environment, status);

  -- ─── Tenant Users / Enrollments ──────────────────────────
  CREATE TABLE IF NOT EXISTS tenant_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    environment VARCHAR(10) NOT NULL
      CHECK (environment IN ('live', 'test')),
    external_id VARCHAR(100) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    employee_code VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'inactive')),
    primary_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    last_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, environment, external_id)
  );
  CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant ON tenant_users(tenant_id, environment, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tenant_users_status ON tenant_users(tenant_id, environment, status);

  -- ─── Verification Events ─────────────────────────────────
  CREATE TABLE IF NOT EXISTS verification_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    environment VARCHAR(10) NOT NULL
      CHECK (environment IN ('live', 'test')),
    user_id UUID REFERENCES tenant_users(id) ON DELETE SET NULL,
    device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    method VARCHAR(20) NOT NULL
      CHECK (method IN ('zkp', 'fingerprint', 'face', 'depth', 'saml', 'oidc', 'manual')),
    result VARCHAR(20) NOT NULL
      CHECK (result IN ('pass', 'fail', 'challenge')),
    reason VARCHAR(255),
    confidence_score NUMERIC(5, 2),
    reference_id VARCHAR(255),
    metadata JSONB NOT NULL DEFAULT '{}',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_verification_events_tenant ON verification_events(tenant_id, environment, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_verification_events_user ON verification_events(tenant_id, environment, user_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_verification_events_device ON verification_events(tenant_id, environment, device_id, occurred_at DESC);

  -- ─── Attendance Events ───────────────────────────────────
  CREATE TABLE IF NOT EXISTS attendance_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    environment VARCHAR(10) NOT NULL
      CHECK (environment IN ('live', 'test')),
    user_id UUID NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
    device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    verification_id UUID REFERENCES verification_events(id) ON DELETE SET NULL,
    event_type VARCHAR(20) NOT NULL
      CHECK (event_type IN ('check_in', 'check_out')),
    result VARCHAR(20) NOT NULL
      CHECK (result IN ('accepted', 'rejected')),
    metadata JSONB NOT NULL DEFAULT '{}',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_attendance_events_tenant ON attendance_events(tenant_id, environment, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_attendance_events_user ON attendance_events(tenant_id, environment, user_id, occurred_at DESC);

  -- ─── Audit Events ────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS audit_events (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    environment VARCHAR(10)
      CHECK (environment IN ('live', 'test')),
    actor_type VARCHAR(20) NOT NULL
      CHECK (actor_type IN ('api_key', 'console', 'device', 'system')),
    actor_id VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(255),
    status VARCHAR(20) NOT NULL
      CHECK (status IN ('success', 'failure')),
    summary VARCHAR(255) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_audit_events_tenant ON audit_events(tenant_id, environment, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(tenant_id, action, created_at DESC);
`;

export async function initDb(): Promise<void> {
  pool = new Pool({
    host: config.postgres.host,
    port: config.postgres.port,
    database: config.postgres.database,
    user: config.postgres.user,
    password: config.postgres.password,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  const client = await pool.connect();
  try {
    await client.query(SCHEMA);
    logger.info('PostgreSQL connected and schema ready', {
      host: config.postgres.host,
      database: config.postgres.database,
    });
  } finally {
    client.release();
  }
}

export function getPool(): Pool {
  if (!pool) throw new Error('Database not initialized. Call initDb() first.');
  return pool;
}

export function getPoolOrNull(): Pool | null {
  return pool;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('PostgreSQL pool closed');
  }
}
