/**
 * Local HTTP bridge for the ZeroAuth fingerprint demo.
 *
 * Browsers can't talk to a UART directly (Web Serial is gated, varies by
 * browser, and even where it works it's a poor fit for a held-open serial
 * port). This process is the bridge: it owns the open R307, serializes
 * access with a mutex, and exposes two endpoints the demo page calls.
 *
 *   POST /api/demo/signup  { email }       enroll a finger and bind it to
 *                                          the email at the next free slot.
 *                                          Two captures (place → lift → place).
 *
 *   POST /api/demo/login   { email }       single scan + 1:N search on the
 *                                          sensor's stored templates. Login
 *                                          succeeds iff the matched slot is
 *                                          the same one we bound to this
 *                                          email at signup.
 *
 *   GET  /api/demo/accounts                returns the in-memory list. Demo-
 *                                          only; never copy into prod.
 *
 *   POST /api/demo/reset                   wipe sensor + clear the binding
 *                                          map.
 *
 *   GET  /                                 serves iot/demo/index.html
 *
 * Persistence: the email → slot map is mirrored to `iot/data/demo-accounts.json`
 * on every change so the demo survives `Ctrl-C` + restart. The R307's own
 * template storage is already persistent.
 *
 * Security caveats (please re-read before reusing this anywhere real):
 *   - The bridge listens on 127.0.0.1 only. Even so, ANY local process can
 *     reach the API. That's fine for a single-operator laptop demo, NOT
 *     fine for a shared workstation.
 *   - No auth on the endpoints. Anyone who can reach the port can enroll
 *     fingerprints or list accounts.
 *   - The bridge does NOT do the "real" ZeroAuth pipeline (fuzzy extractor
 *     → Poseidon → Groth16). The matching here is the sensor's internal
 *     algorithm, and the slot index travels in the clear over loopback.
 */

import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONF, R307Sensor } from './sensor.js';
import { deriveSignals, shortHex } from './crypto.js';
import { generateProof, verifyProof, initProver } from './proof.js';
import * as otp from './otp.js';
import { OtpRateLimitedError } from './otp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.ZA_IOT_BRIDGE_PORT ?? 3100);
const HOST = process.env.ZA_IOT_BRIDGE_HOST ?? '127.0.0.1';
const SERIAL_PATH = process.env.ZA_IOT_PORT ?? '/dev/cu.usbserial-0001';
const SERIAL_BAUD = Number.parseInt(process.env.ZA_IOT_BAUD ?? '57600', 10);
const SERIAL_PASSWORD = Number.parseInt(process.env.ZA_IOT_PASSWORD ?? '0', 16);

/**
 * In dev (default), the bridge returns the freshly-issued OTP in the
 * /api/demo/request-otp response so the operator can use the demo
 * without SMTP. Set `ZA_IOT_HIDE_OTP=1` to flip into "production
 * shape" — the response then carries only metadata + the operator has
 * to read the OTP from the bridge logs (or from their inbox once an
 * email transport is wired).
 */
const DEV_SHOW_OTP = process.env.ZA_IOT_HIDE_OTP !== '1';

const ACCOUNTS_FILE = path.resolve(__dirname, '..', 'data', 'demo-accounts.json');
const DEMO_HTML_PATH = path.resolve(__dirname, '..', 'demo', 'index.html');
const FAVICON_SVG_PATH = path.resolve(__dirname, '..', '..', 'public', 'zeroauth-mark.svg');

/**
 * Minimum 1:1 match score (R307 reports 0-300+ at security level 3).
 * Anything below this is treated as "not the right finger." Tunable;
 * level-3 scoring on this unit hovers in the 80–180 range for the
 * same finger, single-digit when fingers differ.
 */
const MATCH_THRESHOLD = 50;

/**
 * Per-Pramaan storage: the sensor's flash slots are NOT used at all.
 * The host owns the template, the commitment, and the proof-side public
 * signals. Capacity is bound only by disk. The sensor is reduced to two
 * roles: (1) capture+combine produces the stable template at signup;
 * (2) 1:1 MATCH at login compares a fresh capture against the host-
 * supplied template downloaded into buf2.
 *
 * Storing the template on the host is the demo's compromise vs. real
 * Pramaan. The production construction wraps the template in a fuzzy-
 * extractor helper string that's information-theoretically useless
 * without a close-enough finger; we approximate that property here by
 * the fact that the template alone can't authenticate — you also need
 * a finger the sensor will match against it.
 */
interface Account {
  email: string;
  /** Base64 of the 768-byte sensor template. Re-downloaded at login. */
  template: string;
  /** decimal string — BN128 scalar */
  salt: string;
  /** decimal string — Poseidon(biometricSecret, salt) */
  commitment: string;
  /** decimal string — Poseidon(SHA-256(did)_F) */
  didHash: string;
  /** decimal string — Poseidon(biometricSecret, didHash) */
  identityBinding: string;
  did: string;
  createdAt: string;
}

// ─── State ────────────────────────────────────────────────────────────────

const accounts = new Map<string, Account>();
let sensor: R307Sensor | null = null;

/**
 * Async mutex around sensor access. The R307 only handles one command at a
 * time and the protocol has no "request id" — concurrent commands collide.
 * Chain everything off a single Promise.
 */
let sensorLock: Promise<unknown> = Promise.resolve();
function withSensorLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = sensorLock.then(() => fn());
  // Suppress unhandled rejection on the chain; callers see their own throw.
  sensorLock = next.catch(() => undefined);
  return next;
}

function isValidAccount(a: unknown): a is Account {
  if (!a || typeof a !== 'object') return false;
  const o = a as Record<string, unknown>;
  return (
    typeof o.email === 'string' &&
    typeof o.template === 'string' &&
    typeof o.salt === 'string' &&
    typeof o.commitment === 'string' &&
    typeof o.didHash === 'string' &&
    typeof o.identityBinding === 'string' &&
    typeof o.did === 'string' &&
    typeof o.createdAt === 'string'
  );
}

async function loadAccounts(): Promise<void> {
  try {
    const raw = await fs.readFile(ACCOUNTS_FILE, 'utf8');
    const arr = JSON.parse(raw) as unknown[];
    let skipped = 0;
    for (const candidate of arr) {
      if (!isValidAccount(candidate)) {
        skipped += 1;
        continue;
      }
      accounts.set(candidate.email.toLowerCase(), candidate);
    }
    if (skipped > 0) {
      console.warn(`[bridge] skipped ${skipped} legacy account(s) without ZK commitment fields — re-signup to migrate.`);
    }
    console.log(`[bridge] restored ${accounts.size} account(s) from ${ACCOUNTS_FILE}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[bridge] could not load accounts: ${(err as Error).message}`);
    }
  }
}

async function saveAccounts(): Promise<void> {
  await fs.mkdir(path.dirname(ACCOUNTS_FILE), { recursive: true });
  const arr = [...accounts.values()];
  await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(arr, null, 2), 'utf8');
}

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

// ─── Sensor flows ─────────────────────────────────────────────────────────

/**
 * Streaming progress events. The bridge emits one of these as a single
 * NDJSON line every time the sensor flow transitions, so the browser
 * can show the right "place finger" / "lift finger" / etc. UI.
 *
 * `step` distinguishes the two captures during signup. For login it's `0`.
 */
export type Phase =
  | { phase: 'awaiting_finger'; step: 1 | 2 | 0 }
  | { phase: 'captured'; step: 1 | 2 | 0 }
  | { phase: 'awaiting_removal'; step: 1 }
  | { phase: 'removed'; step: 1 }
  | { phase: 'uploading_template' }
  | { phase: 'loading_template' }
  | { phase: 'matching'; score?: number }
  | { phase: 'deriving'; commitmentPreview: string }
  | { phase: 'proving' }
  | { phase: 'verifying' }
  /**
   * A capture-or-combine attempt failed for a retryable reason and we're
   * about to start the whole two-capture flow over. The UI should reset
   * its stepper to step 1 and show `reason` so the operator knows what
   * to do differently this time.
   */
  | { phase: 'retry'; attempt: number; reason: string }
  | { phase: 'done'; result: unknown }
  | { phase: 'error'; message: string };

/**
 * Sensor confirmations that mean "user/sensor action problem, try again"
 * rather than "protocol or hardware broken." We auto-restart enrollment
 * on any of these (up to MAX_ENROLL_ATTEMPTS times).
 */
function classifyRetryable(err: Error): string | null {
  const msg = err.message;
  if (msg.includes(`0x${CONF.COMBINE_FAIL.toString(16)}`)) {
    return 'The two scans did not match each other. Use the same finger both times, with similar placement.';
  }
  if (msg.includes(`0x${CONF.TOO_FUZZY.toString(16)}`)) {
    return 'The scan was unclear. Try a cleaner, more centred placement.';
  }
  if (msg.includes(`0x${CONF.TOO_FEW_FEATURE.toString(16)}`)) {
    return 'Not enough ridge detail captured. Press a little more firmly.';
  }
  return null;
}

const MAX_ENROLL_ATTEMPTS = 3;

type ProgressFn = (event: Phase) => void;

export class EmailAlreadyRegisteredError extends Error {
  constructor(public readonly email: string) {
    super(`Email already registered: ${email}`);
    this.name = 'EmailAlreadyRegisteredError';
  }
}

async function enroll(email: string, onProgress: ProgressFn): Promise<Account> {
  if (!sensor) throw new Error('Sensor not initialised');
  if (accounts.has(email)) {
    throw new EmailAlreadyRegisteredError(email);
  }
  return withSensorLock(async () => {
    let lastErr: Error | undefined;
    for (let attempt = 1; attempt <= MAX_ENROLL_ATTEMPTS; attempt++) {
      try {
        console.log(`[bridge] signup: attempt ${attempt}/${MAX_ENROLL_ATTEMPTS}, capture 1/2 for ${email}`);
        onProgress({ phase: 'awaiting_finger', step: 1 });
        await sensor!.waitForFinger();
        onProgress({ phase: 'captured', step: 1 });
        await sensor!.imageToCharBuffer(1);

        console.log('[bridge] signup: waiting for finger removal');
        onProgress({ phase: 'awaiting_removal', step: 1 });
        await sensor!.waitForFingerRemoval();
        onProgress({ phase: 'removed', step: 1 });

        console.log('[bridge] signup: capture 2/2');
        onProgress({ phase: 'awaiting_finger', step: 2 });
        await sensor!.waitForFinger();
        onProgress({ phase: 'captured', step: 2 });
        await sensor!.imageToCharBuffer(2);

        console.log('[bridge] signup: combining captures into template');
        await sensor!.combineToTemplate();

        // Pull the stable template off the sensor into host memory.
        // Sensor's flash slot is never touched — this is the Pramaan
        // shape: sensor captures, host owns everything else.
        console.log('[bridge] signup: uploading template to host');
        onProgress({ phase: 'uploading_template' });
        const templateBytes = await sensor!.uploadCharacteristic(1);

        // Patent-Claim-3 derivation. biometricID = SHA-256(template);
        // commitment = Poseidon(Poseidon(bid, salt), salt).
        const signals = deriveSignals({ templateBytes, email });
        onProgress({ phase: 'deriving', commitmentPreview: shortHex(signals.commitment) });

        console.log('[bridge] signup: generating Groth16 proof');
        onProgress({ phase: 'proving' });
        const { proof, publicSignals } = await generateProof({
          biometricSecret: signals.biometricSecret,
          salt: signals.salt,
          commitment: signals.commitment,
          didHash: signals.didHash,
          identityBinding: signals.identityBinding,
        });

        console.log('[bridge] signup: verifying Groth16 proof');
        onProgress({ phase: 'verifying' });
        const ok = await verifyProof({ proof, publicSignals });
        if (!ok) {
          throw new Error('Signup-time proof failed verification — refusing to persist account.');
        }

        const account: Account = {
          email,
          template: templateBytes.toString('base64'),
          salt: signals.salt.toString(),
          commitment: signals.commitment.toString(),
          didHash: signals.didHash.toString(),
          identityBinding: signals.identityBinding.toString(),
          did: signals.did,
          createdAt: new Date().toISOString(),
        };
        accounts.set(email, account);
        await saveAccounts();
        console.log(`[bridge] signup OK for ${email}, template ${templateBytes.length}B, commitment ${shortHex(signals.commitment)}`);
        return account;
      } catch (err) {
        const reason = classifyRetryable(err as Error);
        if (!reason || attempt === MAX_ENROLL_ATTEMPTS) {
          throw err;
        }
        lastErr = err as Error;
        console.log(`[bridge] signup attempt ${attempt} failed (${reason}); retrying`);
        await sensor!.waitForFingerRemoval().catch(() => undefined);
        onProgress({ phase: 'retry', attempt: attempt + 1, reason });
      }
    }
    throw lastErr ?? new Error('Enrollment exhausted without resolution');
  });
}

interface AuthResult {
  matched: boolean;
  email: string;
  score?: number;
  reason?: 'no_account' | 'no_match' | 'wrong_finger' | 'proof_failed';
  /** Set on success. The commitment the bridge stored for this account. */
  commitmentPreview?: string;
  did?: string;
}

async function authenticate(email: string, onProgress: ProgressFn): Promise<AuthResult> {
  if (!sensor) throw new Error('Sensor not initialised');
  return withSensorLock(async () => {
    const account = accounts.get(email);
    console.log(`[bridge] login: capture for ${email}`);
    onProgress({ phase: 'awaiting_finger', step: 0 });
    await sensor!.waitForFinger();
    onProgress({ phase: 'captured', step: 0 });
    await sensor!.imageToCharBuffer(1);

    if (!account) {
      console.log(`[bridge] login: no account for ${email}`);
      return { matched: false, email, reason: 'no_account' };
    }

    // Per Pramaan: never search the sensor's flash. Push the stored
    // template into buf2, then ask the sensor to MATCH buf1 (fresh
    // capture) against buf2 (the host's stored template). Sensor's role
    // is reduced to capture + 1:1 comparison.
    console.log('[bridge] login: downloading stored template into sensor buf2');
    onProgress({ phase: 'loading_template' });
    const templateBytes = Buffer.from(account.template, 'base64');
    await sensor!.downloadCharacteristic(2, templateBytes);

    console.log('[bridge] login: 1:1 match');
    onProgress({ phase: 'matching' });
    const match = await sensor!.match();
    if (!match) {
      console.log('[bridge] login: sensor reported NO_MATCH');
      return { matched: false, email, reason: 'wrong_finger' };
    }
    onProgress({ phase: 'matching', score: match.score });
    if (match.score < MATCH_THRESHOLD) {
      console.log(`[bridge] login: score ${match.score} below threshold ${MATCH_THRESHOLD}`);
      return { matched: false, email, reason: 'wrong_finger', score: match.score };
    }

    // Match succeeded. Re-derive the ZK signals using the stored template
    // + stored salt — both deterministic, so the commitment + public
    // signals MUST equal the ones we persisted at signup. If they don't,
    // the on-disk account file was tampered with and we refuse to auth.
    const signals = deriveSignals({
      templateBytes,
      email,
      salt: BigInt(account.salt),
    });
    onProgress({ phase: 'deriving', commitmentPreview: shortHex(signals.commitment) });

    console.log('[bridge] login: generating Groth16 proof');
    onProgress({ phase: 'proving' });
    const { proof, publicSignals } = await generateProof({
      biometricSecret: signals.biometricSecret,
      salt: signals.salt,
      commitment: signals.commitment,
      didHash: signals.didHash,
      identityBinding: signals.identityBinding,
    });

    const [pubCommit, pubDidHash, pubBinding] = publicSignals;
    if (
      pubCommit !== account.commitment ||
      pubDidHash !== account.didHash ||
      pubBinding !== account.identityBinding
    ) {
      console.log('[bridge] login: public signal mismatch (stored account corrupted)');
      return { matched: false, email, reason: 'proof_failed' };
    }

    console.log('[bridge] login: verifying Groth16 proof');
    onProgress({ phase: 'verifying' });
    const ok = await verifyProof({ proof, publicSignals });
    if (!ok) {
      console.log('[bridge] login: proof failed verification');
      return { matched: false, email, reason: 'proof_failed' };
    }

    console.log(`[bridge] login OK for ${email} (match score ${match.score}, commitment ${shortHex(signals.commitment)})`);
    return {
      matched: true,
      email,
      score: match.score,
      commitmentPreview: shortHex(signals.commitment),
      did: account.did,
    };
  });
}

async function reset(): Promise<void> {
  // Per Pramaan we no longer use the sensor's flash, so the reset is
  // purely host-side. The sensor only holds transient buffers (cleared
  // implicitly between commands) and any QC templates from the factory
  // that we never used.
  accounts.clear();
  await saveAccounts();
  console.log('[bridge] reset: host accounts cleared (sensor flash untouched)');
}

// ─── HTTP ─────────────────────────────────────────────────────────────────

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8') || '{}';
  return JSON.parse(raw);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

/**
 * Run a sensor flow and stream NDJSON progress events to the response.
 * The handler always finishes the response cleanly; on throw, emits a
 * single `error` phase event and ends. Status code stays 200 because
 * the stream itself carries the success/failure signal — the browser's
 * fetch already has the body open by the time we know the outcome.
 */
async function runStreamed(
  res: http.ServerResponse,
  run: (write: (event: Phase) => void) => Promise<void>,
): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  });
  const write = (event: Phase): void => {
    res.write(JSON.stringify(event) + '\n');
  };
  try {
    await run(write);
  } catch (err) {
    write({ phase: 'error', message: (err as Error).message });
  } finally {
    res.end();
  }
}

async function sendStatic(res: http.ServerResponse, filePath: string, contentType: string): Promise<void> {
  try {
    const body = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      res.writeHead(404).end();
      return;
    }
    throw err;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const isReadable = req.method === 'GET' || req.method === 'HEAD';

    if (isReadable && (url.pathname === '/' || url.pathname === '/index.html')) {
      await sendStatic(res, DEMO_HTML_PATH, 'text/html; charset=utf-8');
      return;
    }
    if (isReadable && url.pathname === '/zeroauth-mark.svg') {
      await sendStatic(res, FAVICON_SVG_PATH, 'image/svg+xml');
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/demo/request-otp') {
      const body = (await readJson(req)) as { email?: unknown; kind?: unknown };
      const email = normalizeEmail(body.email);
      if (!email) {
        sendJson(res, 400, { error: 'invalid_email' });
        return;
      }
      const kind = body.kind === 'signup' || body.kind === 'login' ? body.kind : null;
      if (!kind) {
        sendJson(res, 400, { error: 'invalid_kind' });
        return;
      }
      // Surface the already-registered / no-account checks at the OTP
      // step so the user doesn't waste a code on a hopeless flow.
      if (kind === 'signup' && accounts.has(email)) {
        sendJson(res, 409, { error: 'already_registered', email, did: accounts.get(email)!.did });
        return;
      }
      if (kind === 'login' && !accounts.has(email)) {
        sendJson(res, 404, { error: 'no_account', email });
        return;
      }
      try {
        const issued = otp.request(email, kind);
        // The plaintext code never makes it into the logs — only the
        // metadata. The operator-facing line is below, gated on the
        // dev flag.
        console.log(`[bridge] otp issued for ${email} (${kind}); expires ${issued.expiresAt.toISOString()}`);
        if (DEV_SHOW_OTP) console.log(`[bridge]   DEV_SHOW_OTP code=${issued.code}`);
        sendJson(res, 200, {
          email,
          kind,
          expiresAt: issued.expiresAt.toISOString(),
          ...(DEV_SHOW_OTP ? { devCode: issued.code } : {}),
        });
      } catch (err) {
        if (err instanceof OtpRateLimitedError) {
          sendJson(res, 429, { error: 'rate_limited', retryAfterMs: err.retryAfterMs });
          return;
        }
        sendJson(res, 500, { error: 'otp_request_failed', message: (err as Error).message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/demo/verify-otp') {
      const body = (await readJson(req)) as { email?: unknown; otp?: unknown; kind?: unknown };
      const email = normalizeEmail(body.email);
      if (!email) {
        sendJson(res, 400, { error: 'invalid_email' });
        return;
      }
      const code = typeof body.otp === 'string' ? body.otp.trim() : '';
      if (!/^\d{6}$/.test(code)) {
        sendJson(res, 400, { error: 'invalid_otp_format' });
        return;
      }
      const kind = body.kind === 'signup' || body.kind === 'login' ? body.kind : null;
      if (!kind) {
        sendJson(res, 400, { error: 'invalid_kind' });
        return;
      }
      const result = otp.verify(email, code, kind);
      if (!result.ok) {
        sendJson(res, 401, { error: 'otp_invalid', reason: result.reason });
        return;
      }
      sendJson(res, 200, {
        email: result.email,
        kind: result.kind,
        sessionToken: result.sessionToken,
        sessionExpiresAt: result.sessionExpiresAt.toISOString(),
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/demo/signup') {
      const body = (await readJson(req)) as { email?: unknown; sessionToken?: unknown };
      const email = normalizeEmail(body.email);
      const sessionToken = typeof body.sessionToken === 'string' ? body.sessionToken : '';
      if (!email) {
        sendJson(res, 400, { error: 'invalid_email' });
        return;
      }
      if (accounts.has(email)) {
        sendJson(res, 409, { error: 'already_registered', email, did: accounts.get(email)!.did });
        return;
      }
      if (!sessionToken || !otp.consumeSession(sessionToken, email, 'signup')) {
        sendJson(res, 401, { error: 'otp_required', message: 'Verify your email with the code first.' });
        return;
      }
      await runStreamed(res, async (write) => {
        const account = await enroll(email, write);
        write({
          phase: 'done',
          result: {
            email: account.email,
            createdAt: account.createdAt,
            commitmentPreview: shortHex(BigInt(account.commitment)),
            did: account.did,
          },
        });
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/demo/login') {
      const body = (await readJson(req)) as { email?: unknown; sessionToken?: unknown };
      const email = normalizeEmail(body.email);
      const sessionToken = typeof body.sessionToken === 'string' ? body.sessionToken : '';
      if (!email) {
        sendJson(res, 400, { error: 'invalid_email' });
        return;
      }
      if (!sessionToken || !otp.consumeSession(sessionToken, email, 'login')) {
        sendJson(res, 401, { error: 'otp_required', message: 'Verify your email with the code first.' });
        return;
      }
      await runStreamed(res, async (write) => {
        const result = await authenticate(email, write);
        write({ phase: 'done', result });
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/demo/accounts') {
      sendJson(res, 200, [...accounts.values()]);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/demo/reset') {
      try {
        await reset();
        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 500, { error: 'reset_failed', message: (err as Error).message });
      }
      return;
    }

    res.writeHead(404).end();
  } catch (err) {
    sendJson(res, 500, { error: 'internal_error', message: (err as Error).message });
  }
});

async function main(): Promise<void> {
  await loadAccounts();

  console.log('[bridge] preloading Groth16 proving + verification keys…');
  await initProver();

  sensor = new R307Sensor({
    path: SERIAL_PATH,
    baudRate: SERIAL_BAUD,
    password: SERIAL_PASSWORD,
    fingerTimeoutMs: 30_000, // demo gives the user a generous window
  });

  console.log(`[bridge] opening ${SERIAL_PATH} @ ${SERIAL_BAUD} baud…`);
  await sensor.open();
  const ok = await sensor.verifyPassword();
  if (!ok) {
    console.error('[bridge] sensor password verification failed.');
    process.exit(1);
  }

  server.listen(PORT, HOST, () => {
    console.log(`[bridge] demo running at http://${HOST}:${PORT}`);
    console.log(`[bridge] open that URL in your browser to use the fingerprint demo.`);
  });

  const shutdown = async (sig: string): Promise<void> => {
    console.log(`\n[bridge] ${sig} — closing sensor + server`);
    server.close();
    if (sensor) await sensor.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
