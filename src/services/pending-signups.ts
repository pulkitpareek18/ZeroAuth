import crypto from 'crypto';
import { getPool } from './db';
import { logger } from './logger';

/**
 * Pending-signups store for the F-2 v2 byte-identical signup flow.
 *
 * Why this exists:
 *   The fast path (POST /api/console/signup creates a tenant immediately,
 *   returns the JWT + API key in one round-trip) is a textbook email-
 *   enumeration vector — 201 vs 409 telegraphs whether an address is
 *   registered. The v2 fix splits creation into two steps:
 *
 *     1. POST /api/console/signup ALWAYS returns 202 with the same body
 *        (regardless of whether the email is taken). If the email is
 *        fresh, we park the request here in `pending_signups` and email
 *        a one-shot verification link. If the email is taken, we send
 *        a security-signal notice to the legitimate holder. Both paths
 *        consume comparable CPU (scrypt dominates), keeping the timing
 *        side-channel closed too.
 *
 *     2. GET /api/console/verify-signup?token=… consumes the token,
 *        creates the real tenant + API key, and redirects to the
 *        dashboard.
 *
 * Security properties of this module:
 *   - Tokens are 32 random bytes (256 bits) of urandom — well past any
 *     guessing threshold inside the 24h expiry window.
 *   - Only the SHA-256 of the token is persisted. If the DB is read by
 *     an attacker, they can't replay live tokens — they'd need to
 *     intercept the email body too. (sha256 is fine here; we're not
 *     hashing a low-entropy password — we're indexing a 256-bit nonce.)
 *   - `consume()` is a single UPDATE that atomically marks the row
 *     consumed in the same statement that returns the payload, so a
 *     racing second click can't double-consume.
 *   - Expired rows refuse to consume. A periodic purge keeps the table
 *     bounded.
 */

export interface PendingSignup {
  email: string;
  passwordHash: string;
  companyName: string | null;
}

const TOKEN_BYTES = 32;
const TTL_HOURS = 24;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Create a pending-signup row and return the raw token. The caller is
 * responsible for emailing the verify link to the operator — the token
 * is never persisted plaintext, so this is the only chance to use it.
 */
export async function createPendingSignup(input: PendingSignup): Promise<{ token: string; expiresAt: Date }> {
  const pool = getPool();
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TTL_HOURS * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO pending_signups (email, password_hash, company_name, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.email.trim().toLowerCase(), input.passwordHash, input.companyName?.trim() || null, tokenHash, expiresAt],
  );

  logger.info('Pending signup parked', { email: input.email, expiresAt });
  return { token, expiresAt };
}

/**
 * Consume a verification token. Returns the parked payload on success,
 * null if the token is unknown / expired / already consumed.
 *
 * Atomically marks the row consumed so a second click is a no-op. The
 * caller should treat the returned payload as one-shot — the row is
 * gone after this call returns (logically; the row stays for audit
 * with consumed_at set, but consume() will never return it again).
 */
export async function consumePendingSignup(token: string): Promise<PendingSignup | null> {
  const pool = getPool();
  const tokenHash = hashToken(token);

  const result = await pool.query(
    `UPDATE pending_signups
        SET consumed_at = NOW()
      WHERE token_hash = $1
        AND consumed_at IS NULL
        AND expires_at > NOW()
      RETURNING email, password_hash, company_name`,
    [tokenHash],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    email: row.email,
    passwordHash: row.password_hash,
    companyName: row.company_name,
  };
}

/**
 * Delete expired pending-signup rows. Intended to be called from a
 * periodic cron; safe to call any time. Returns the number of rows
 * removed.
 */
export async function purgeExpiredPendingSignups(): Promise<number> {
  const pool = getPool();
  const result = await pool.query(
    `DELETE FROM pending_signups
      WHERE expires_at <= NOW()
         OR (consumed_at IS NOT NULL AND consumed_at < NOW() - INTERVAL '7 days')`,
  );
  if (result.rowCount && result.rowCount > 0) {
    logger.info('Purged pending signups', { removed: result.rowCount });
  }
  return result.rowCount ?? 0;
}
