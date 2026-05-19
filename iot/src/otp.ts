/**
 * Email-OTP service for the fingerprint demo.
 *
 * The flow is plain MFA: the user proves email ownership with a 6-digit
 * code, THEN places their finger. The OTP plus the finger together are
 * the credential; either alone isn't enough.
 *
 * Two artefacts, both in-process Maps:
 *
 *   `pending`  : email → { codeHash, expiresAt, attempts, kind }
 *   `sessions` : sessionToken → { email, kind, verifiedAt, expiresAt }
 *
 * `request()` generates a code, stores its SHA-256 hash, and returns
 * the plaintext. The caller (the bridge's HTTP handler) is responsible
 * for delivering it — either over real SMTP (when configured) or by
 * surfacing it in the API response in dev mode.
 *
 * `verify()` checks the code, increments the attempts counter, and on
 * success consumes the pending entry + mints a single-use session
 * token that the signup/login endpoint requires. Tokens are bound to
 * one (email, kind) pair and expire after 2 minutes — enough time to
 * place a finger but not enough for offline replay.
 *
 * Constant-time comparison is via `crypto.timingSafeEqual` over the
 * hash buffers. The plaintext code itself is never persisted.
 *
 * Demo-grade: in-memory only. Restarting the bridge wipes pending
 * codes and sessions, which is what you want for a demo (no stale
 * state surviving a Ctrl-C / re-launch cycle).
 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export type OtpKind = 'signup' | 'login';

export interface RequestOtpResult {
  /** The plaintext 6-digit code. Caller decides how to deliver it. */
  code: string;
  /** When the code expires. Absolute timestamp. */
  expiresAt: Date;
}

export interface VerifyOk {
  ok: true;
  email: string;
  kind: OtpKind;
  /** One-shot token the signup/login endpoint must echo back. */
  sessionToken: string;
  sessionExpiresAt: Date;
}
export interface VerifyErr {
  ok: false;
  reason: 'no_pending' | 'expired' | 'too_many_attempts' | 'wrong_code' | 'kind_mismatch';
}
export type VerifyResult = VerifyOk | VerifyErr;

const CODE_LENGTH = 6;
const CODE_TTL_MS = 5 * 60 * 1000;          // 5 minutes
const SESSION_TTL_MS = 2 * 60 * 1000;       // 2 minutes
const MAX_ATTEMPTS = 5;
const REQUEST_COOLDOWN_MS = 30 * 1000;      // 30 seconds between resends

interface PendingEntry {
  codeHash: Buffer;
  expiresAt: number;
  attempts: number;
  kind: OtpKind;
  /** Used for resend cooldown. */
  issuedAt: number;
}

interface Session {
  email: string;
  kind: OtpKind;
  expiresAt: number;
}

const pending = new Map<string, PendingEntry>();
const sessions = new Map<string, Session>();

function hashCode(code: string): Buffer {
  return createHash('sha256').update(code, 'utf8').digest();
}

function generateCode(): string {
  // 000000 – 999999, zero-padded. randomInt is uniform.
  return randomInt(0, 1_000_000).toString().padStart(CODE_LENGTH, '0');
}

/**
 * Request a fresh OTP for (email, kind). Returns the plaintext code so
 * the caller can deliver it (SMTP or dev-mode response). Throws if the
 * caller is hitting the resend cooldown window — the bridge surfaces
 * that as a 429-flavoured response.
 */
export class OtpRateLimitedError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`OTP rate-limited; retry in ${Math.ceil(retryAfterMs / 1000)}s`);
    this.name = 'OtpRateLimitedError';
  }
}

export function request(email: string, kind: OtpKind): RequestOtpResult {
  const now = Date.now();
  const key = `${email}|${kind}`;
  const existing = pending.get(key);
  if (existing && now - existing.issuedAt < REQUEST_COOLDOWN_MS) {
    throw new OtpRateLimitedError(REQUEST_COOLDOWN_MS - (now - existing.issuedAt));
  }

  const code = generateCode();
  pending.set(key, {
    codeHash: hashCode(code),
    expiresAt: now + CODE_TTL_MS,
    attempts: 0,
    kind,
    issuedAt: now,
  });
  return {
    code,
    expiresAt: new Date(now + CODE_TTL_MS),
  };
}

export function verify(email: string, code: string, kind: OtpKind): VerifyResult {
  const key = `${email}|${kind}`;
  const entry = pending.get(key);
  if (!entry) return { ok: false, reason: 'no_pending' };

  const now = Date.now();
  if (now >= entry.expiresAt) {
    pending.delete(key);
    return { ok: false, reason: 'expired' };
  }
  if (entry.kind !== kind) {
    return { ok: false, reason: 'kind_mismatch' };
  }
  if (entry.attempts >= MAX_ATTEMPTS) {
    pending.delete(key);
    return { ok: false, reason: 'too_many_attempts' };
  }

  entry.attempts += 1;
  const submitted = hashCode(code);
  // timingSafeEqual requires equal length. hash output is fixed-size
  // 32 bytes for sha256 so this always passes.
  const matched = submitted.length === entry.codeHash.length && timingSafeEqual(submitted, entry.codeHash);
  if (!matched) {
    if (entry.attempts >= MAX_ATTEMPTS) {
      pending.delete(key);
      return { ok: false, reason: 'too_many_attempts' };
    }
    return { ok: false, reason: 'wrong_code' };
  }

  // Success — consume the pending entry and mint a one-shot session.
  pending.delete(key);
  const sessionToken = randomBytes(24).toString('base64url');
  sessions.set(sessionToken, {
    email,
    kind,
    expiresAt: now + SESSION_TTL_MS,
  });
  return {
    ok: true,
    email,
    kind,
    sessionToken,
    sessionExpiresAt: new Date(now + SESSION_TTL_MS),
  };
}

/**
 * Consume a session token. Returns true iff the token was valid AND was
 * for (email, kind). One-shot — successful consumption deletes the
 * session. The signup/login endpoints call this at the start of their
 * stream, so an OTP-verified user has ~2 minutes to actually present
 * their finger.
 */
export function consumeSession(sessionToken: string, email: string, kind: OtpKind): boolean {
  const session = sessions.get(sessionToken);
  if (!session) return false;
  sessions.delete(sessionToken); // one-shot regardless of outcome
  if (session.expiresAt < Date.now()) return false;
  if (session.email !== email) return false;
  if (session.kind !== kind) return false;
  return true;
}

/** Periodic cleanup. Cheap to run; called from the bridge's reset path. */
export function gc(): void {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expiresAt < now) pending.delete(k);
  for (const [k, v] of sessions) if (v.expiresAt < now) sessions.delete(k);
}
