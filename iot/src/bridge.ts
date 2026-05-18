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
import { R307Sensor } from './sensor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.ZA_IOT_BRIDGE_PORT ?? 3100);
const HOST = process.env.ZA_IOT_BRIDGE_HOST ?? '127.0.0.1';
const SERIAL_PATH = process.env.ZA_IOT_PORT ?? '/dev/cu.usbserial-0001';
const SERIAL_BAUD = Number.parseInt(process.env.ZA_IOT_BAUD ?? '57600', 10);
const SERIAL_PASSWORD = Number.parseInt(process.env.ZA_IOT_PASSWORD ?? '0', 16);

const ACCOUNTS_FILE = path.resolve(__dirname, '..', 'data', 'demo-accounts.json');
const DEMO_HTML_PATH = path.resolve(__dirname, '..', 'demo', 'index.html');
const FAVICON_SVG_PATH = path.resolve(__dirname, '..', '..', 'public', 'zeroauth-mark.svg');

interface Account {
  email: string;
  slot: number;
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

async function loadAccounts(): Promise<void> {
  try {
    const raw = await fs.readFile(ACCOUNTS_FILE, 'utf8');
    const arr = JSON.parse(raw) as Account[];
    for (const a of arr) accounts.set(a.email.toLowerCase(), a);
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

function nextFreeSlot(): number {
  const used = new Set([...accounts.values()].map((a) => a.slot));
  for (let i = 0; i < 1000; i++) {
    if (!used.has(i)) return i;
  }
  throw new Error('No free slot left on sensor (capacity is 1000).');
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
  | { phase: 'storing' }
  | { phase: 'searching' }
  | { phase: 'done'; result: unknown }
  | { phase: 'error'; message: string };

type ProgressFn = (event: Phase) => void;

async function enroll(email: string, onProgress: ProgressFn): Promise<Account> {
  if (!sensor) throw new Error('Sensor not initialised');
  return withSensorLock(async () => {
    const existing = accounts.get(email);
    const slot = existing?.slot ?? nextFreeSlot();

    console.log(`[bridge] signup: capture 1/2 for ${email} @ slot ${slot}`);
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

    console.log('[bridge] signup: combining + storing…');
    onProgress({ phase: 'storing' });
    await sensor!.combineToTemplate();
    await sensor!.storeTemplate(slot);

    const account: Account = {
      email,
      slot,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    accounts.set(email, account);
    await saveAccounts();
    console.log(`[bridge] signup OK for ${email} @ slot ${slot}`);
    return account;
  });
}

interface AuthResult {
  matched: boolean;
  email: string;
  score?: number;
  reason?: 'no_account' | 'no_match' | 'wrong_finger';
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

    onProgress({ phase: 'searching' });
    const result = await sensor!.search();

    if (!account) {
      console.log(`[bridge] login: no account for ${email}`);
      return { matched: false, email, reason: 'no_account' };
    }
    if (!result) {
      console.log(`[bridge] login: no match found on sensor`);
      return { matched: false, email, reason: 'no_match' };
    }
    if (result.pageId !== account.slot) {
      console.log(`[bridge] login: matched slot ${result.pageId} but ${email} is bound to slot ${account.slot}`);
      return { matched: false, email, reason: 'wrong_finger', score: result.matchScore };
    }
    console.log(`[bridge] login OK for ${email} @ slot ${result.pageId} (score ${result.matchScore})`);
    return { matched: true, email, score: result.matchScore };
  });
}

async function reset(): Promise<void> {
  if (!sensor) throw new Error('Sensor not initialised');
  await withSensorLock(async () => {
    await sensor!.emptyDatabase();
  });
  accounts.clear();
  await saveAccounts();
  console.log('[bridge] reset: wiped sensor library + accounts map');
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

    if (req.method === 'POST' && url.pathname === '/api/demo/signup') {
      const body = (await readJson(req)) as { email?: unknown };
      const email = normalizeEmail(body.email);
      if (!email) {
        sendJson(res, 400, { error: 'invalid_email' });
        return;
      }
      await runStreamed(res, async (write) => {
        const account = await enroll(email, write);
        write({ phase: 'done', result: { email: account.email, slot: account.slot, createdAt: account.createdAt } });
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/demo/login') {
      const body = (await readJson(req)) as { email?: unknown };
      const email = normalizeEmail(body.email);
      if (!email) {
        sendJson(res, 400, { error: 'invalid_email' });
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
