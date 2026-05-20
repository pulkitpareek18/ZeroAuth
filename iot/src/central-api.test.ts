/**
 * Tests for the CentralApiClient. Uses node:test (built-in, no extra
 * dev-deps) and a hand-rolled mock fetch — keeps the iot/ workspace
 * dependency-free.
 *
 * Run with:
 *   npm --prefix iot test
 */

import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  CentralApiClient,
  type CentralApiConfig,
  readConfigFromEnv,
} from './central-api.js';

const baseCfg: CentralApiConfig = {
  baseUrl: 'https://api.test.local',
  apiKey: 'za_test_dummykey',
  deviceExternalId: 'iot-bridge-fixture',
  deviceName: 'IoT bridge (test)',
  timeoutMs: 1000,
};

type Call = { method: string; url: string; body: unknown; headers: Headers };

function makeMockFetch(handler: (call: Call) => Response | Promise<Response>): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : null;
    const headers = new Headers(init?.headers);
    const call: Call = { method, url, body, headers };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

describe('readConfigFromEnv', () => {
  it('returns null when ZA_CENTRAL_API_URL is missing', () => {
    assert.equal(readConfigFromEnv({}), null);
    assert.equal(readConfigFromEnv({ ZA_CENTRAL_API_KEY: 'k' }), null);
  });

  it('returns null when ZA_CENTRAL_API_KEY is missing', () => {
    assert.equal(readConfigFromEnv({ ZA_CENTRAL_API_URL: 'https://x' }), null);
  });

  it('strips trailing slashes from the base URL', () => {
    const cfg = readConfigFromEnv({
      ZA_CENTRAL_API_URL: 'https://api.zeroauth.dev///',
      ZA_CENTRAL_API_KEY: 'za_test_x',
    });
    assert.equal(cfg?.baseUrl, 'https://api.zeroauth.dev');
  });

  it('falls back to defaults for optional fields', () => {
    const cfg = readConfigFromEnv({
      ZA_CENTRAL_API_URL: 'https://api.zeroauth.dev',
      ZA_CENTRAL_API_KEY: 'za_test_x',
    });
    assert.ok(cfg?.deviceExternalId.startsWith('iot-bridge-'));
    assert.equal(cfg?.deviceName, 'IoT bridge');
    assert.equal(cfg?.timeoutMs, 5000);
  });

  it('honours explicit overrides', () => {
    const cfg = readConfigFromEnv({
      ZA_CENTRAL_API_URL: 'https://api.zeroauth.dev',
      ZA_CENTRAL_API_KEY: 'za_test_x',
      ZA_CENTRAL_DEVICE_ID: 'lobby-01',
      ZA_CENTRAL_DEVICE_NAME: 'Lobby terminal 1',
      ZA_CENTRAL_API_TIMEOUT_MS: '12000',
    });
    assert.equal(cfg?.deviceExternalId, 'lobby-01');
    assert.equal(cfg?.deviceName, 'Lobby terminal 1');
    assert.equal(cfg?.timeoutMs, 12000);
  });
});

describe('CentralApiClient.ensureDevice', () => {
  it('creates a fresh device on 201 and caches the result', async () => {
    let postCount = 0;
    const { fetchImpl, calls } = makeMockFetch(call => {
      if (call.method === 'POST' && call.url.endsWith('/v1/devices')) {
        postCount += 1;
        return new Response(JSON.stringify({ device: { id: 'dev_abc', external_id: 'iot-bridge-fixture' } }), { status: 201 });
      }
      return new Response('{}', { status: 500 });
    });
    const client = new CentralApiClient(baseCfg, { fetchImpl, logger: silentLogger });
    const first = await client.ensureDevice();
    const second = await client.ensureDevice();
    assert.equal(first?.id, 'dev_abc');
    assert.equal(second?.id, 'dev_abc');
    // Cache hit on the second call — no new network traffic.
    assert.equal(postCount, 1);
    assert.equal(calls[0].headers.get('Authorization'), `Bearer ${baseCfg.apiKey}`);
  });

  it('falls back to GET /v1/devices on 409 and finds the existing record', async () => {
    const { fetchImpl } = makeMockFetch(call => {
      if (call.method === 'POST' && call.url.endsWith('/v1/devices')) {
        return new Response(JSON.stringify({ error: 'device_external_id_taken' }), { status: 409 });
      }
      if (call.method === 'GET' && call.url.includes('/v1/devices')) {
        return new Response(JSON.stringify({
          devices: [
            { id: 'dev_other', external_id: 'something-else' },
            { id: 'dev_existing', external_id: 'iot-bridge-fixture' },
          ],
        }), { status: 200 });
      }
      return new Response('{}', { status: 500 });
    });
    const client = new CentralApiClient(baseCfg, { fetchImpl, logger: silentLogger });
    const device = await client.ensureDevice();
    assert.equal(device?.id, 'dev_existing');
  });

  it('returns null when the API is unreachable', async () => {
    const fetchImpl = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    const client = new CentralApiClient(baseCfg, { fetchImpl, logger: silentLogger });
    assert.equal(await client.ensureDevice(), null);
  });
});

describe('CentralApiClient.registerUser', () => {
  it('returns the created user on 201', async () => {
    const { fetchImpl } = makeMockFetch(() =>
      new Response(JSON.stringify({ user: { id: 'usr_1', external_id: 'a@b.com', full_name: 'a@b.com' } }), { status: 201 }),
    );
    const client = new CentralApiClient(baseCfg, { fetchImpl, logger: silentLogger });
    const user = await client.registerUser('a@b.com');
    assert.equal(user?.id, 'usr_1');
  });

  it('does a list lookup on 409', async () => {
    const { fetchImpl } = makeMockFetch(call => {
      if (call.method === 'POST') return new Response(JSON.stringify({ error: 'user_external_id_taken' }), { status: 409 });
      return new Response(JSON.stringify({
        users: [{ id: 'usr_2', external_id: 'a@b.com', full_name: 'a@b.com' }],
      }), { status: 200 });
    });
    const client = new CentralApiClient(baseCfg, { fetchImpl, logger: silentLogger });
    assert.equal((await client.registerUser('a@b.com'))?.id, 'usr_2');
  });

  it('returns null on unexpected 500', async () => {
    const { fetchImpl } = makeMockFetch(() => new Response('boom', { status: 500 }));
    const client = new CentralApiClient(baseCfg, { fetchImpl, logger: silentLogger });
    assert.equal(await client.registerUser('a@b.com'), null);
  });
});

describe('CentralApiClient.recordVerification + recordCheckIn', () => {
  it('posts the correct payload shapes', async () => {
    const seen: Array<{ url: string; body: unknown }> = [];
    const { fetchImpl } = makeMockFetch(call => {
      seen.push({ url: call.url, body: call.body });
      if (call.url.endsWith('/v1/verifications')) {
        return new Response(JSON.stringify({ verification: { id: 'ver_1', method: 'fingerprint', result: 'pass' } }), { status: 201 });
      }
      if (call.url.endsWith('/v1/attendance')) {
        return new Response(JSON.stringify({ attendance: { id: 'att_1', event_type: 'check_in', result: 'accepted' } }), { status: 201 });
      }
      return new Response('{}', { status: 500 });
    });

    const client = new CentralApiClient(baseCfg, { fetchImpl, logger: silentLogger });

    const v = await client.recordVerification({
      userId: 'usr_1',
      deviceId: 'dev_1',
      method: 'fingerprint',
      result: 'pass',
      confidenceScore: 120,
      referenceId: 'iot-bridge:42',
    });
    const a = await client.recordCheckIn({
      userId: 'usr_1',
      deviceId: 'dev_1',
      verificationId: v!.id,
      type: 'check_in',
      result: 'accepted',
    });

    assert.equal(v?.id, 'ver_1');
    assert.equal(a?.id, 'att_1');
    assert.equal(seen.length, 2);
    assert.deepEqual(seen[0].body, {
      userId: 'usr_1',
      deviceId: 'dev_1',
      method: 'fingerprint',
      result: 'pass',
      confidenceScore: 120,
      referenceId: 'iot-bridge:42',
    });
    assert.deepEqual(seen[1].body, {
      userId: 'usr_1',
      deviceId: 'dev_1',
      verificationId: 'ver_1',
      type: 'check_in',
      result: 'accepted',
    });
  });
});

describe('CentralApiClient timeouts', () => {
  let timeouts: ReturnType<typeof setTimeout>[];

  beforeEach(() => { timeouts = []; });
  afterEach(() => { for (const t of timeouts) clearTimeout(t); });

  it('aborts long requests and returns null', async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          if (signal.aborted) {
            const err = new Error('aborted');
            (err as Error & { name: string }).name = 'AbortError';
            reject(err);
            return;
          }
          signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            (err as Error & { name: string }).name = 'AbortError';
            reject(err);
          });
        }
      })) as unknown as typeof fetch;

    const client = new CentralApiClient(
      { ...baseCfg, timeoutMs: 30 },
      { fetchImpl, logger: silentLogger },
    );
    const user = await client.registerUser('slow@example.com');
    assert.equal(user, null);
  });
});
