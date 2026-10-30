import { randomUUID } from 'node:crypto';

export const SCHEMA = 'buzz_identity';

export async function initializeStore(pool) {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.principals (
      id uuid PRIMARY KEY,
      issuer text NOT NULL,
      upstream_sub text NOT NULL,
      email text NOT NULL,
      nostr_pubkey char(64),
      grant_epoch bigint NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (issuer, upstream_sub)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS principals_nostr_key_unique ON ${SCHEMA}.principals(nostr_pubkey) WHERE nostr_pubkey IS NOT NULL;
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.key_roles (
      pubkey char(64) PRIMARY KEY,
      role text NOT NULL CHECK (role IN ('human', 'agent')),
      owner_id uuid NOT NULL REFERENCES ${SCHEMA}.principals(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.browser_flows (
      state_hash char(64) PRIMARY KEY,
      nonce text NOT NULL,
      verifier text NOT NULL,
      return_to text NOT NULL,
      handoff_challenge text NOT NULL,
      expires_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.login_codes (
      code_hash char(64) PRIMARY KEY,
      principal_id uuid NOT NULL REFERENCES ${SCHEMA}.principals(id),
      handoff_challenge text NOT NULL,
      email text NOT NULL,
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.sessions (
      token_hash char(64) PRIMARY KEY,
      principal_id uuid NOT NULL REFERENCES ${SCHEMA}.principals(id),
      email text NOT NULL,
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.agent_grants (
      id uuid PRIMARY KEY,
      owner_id uuid NOT NULL REFERENCES ${SCHEMA}.principals(id),
      owner_pubkey char(64) NOT NULL,
      agent_pubkey char(64) NOT NULL,
      relay_url text NOT NULL,
      token_hash char(64) NOT NULL UNIQUE,
      owner_epoch bigint NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz
    );
    ALTER TABLE ${SCHEMA}.agent_grants ADD COLUMN IF NOT EXISTS expires_at timestamptz;
    CREATE UNIQUE INDEX IF NOT EXISTS agent_grants_active_key_unique ON ${SCHEMA}.agent_grants(agent_pubkey) WHERE revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS agent_grants_owner_idx ON ${SCHEMA}.agent_grants(owner_id);
    CREATE INDEX IF NOT EXISTS sessions_principal_idx ON ${SCHEMA}.sessions(principal_id);
  `);
}

export async function withTransaction(pool, run) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getOrCreatePrincipal(client, issuer, subject, email) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO ${SCHEMA}.principals (id, issuer, upstream_sub, email) VALUES ($1, $2, $3, $4) ON CONFLICT (issuer, upstream_sub) DO UPDATE SET email = EXCLUDED.email RETURNING *`,
    [id, issuer, subject, email],
  );
  return result.rows[0];
}


export async function cleanupExpiredRows(pool) {
  await pool.query(`DELETE FROM ${SCHEMA}.browser_flows WHERE expires_at <= now()`);
  await pool.query(`DELETE FROM ${SCHEMA}.login_codes WHERE expires_at <= now() OR consumed_at IS NOT NULL`);
  await pool.query(`DELETE FROM ${SCHEMA}.sessions WHERE expires_at <= now() OR revoked_at IS NOT NULL`);
}
