/**
 * Central API client for the IoT bridge.
 *
 * Bridges the local fingerprint-demo flow to the hosted ZeroAuth API at
 * https://api.zeroauth.dev. When configured (via env), every successful
 * signup posts a tenant user, and every successful login posts a
 * verification event + an attendance check-in. When unconfigured, all
 * methods no-op so the local demo keeps working with no central-API
 * dependency.
 *
 * Config (read from process.env at construction time):
 *
 *   ZA_CENTRAL_API_URL        e.g. https://api.zeroauth.dev (no trailing /)
 *   ZA_CENTRAL_API_KEY        za_test_… or za_live_… tenant key
 *   ZA_CENTRAL_DEVICE_ID      external_id we want this device to claim
 *                             (default: 'iot-bridge-{hostname}')
 *   ZA_CENTRAL_DEVICE_NAME    display name shown on the dashboard
 *                             (default: 'IoT bridge')
 *   ZA_CENTRAL_API_TIMEOUT_MS network timeout per call (default 5000)
 *
 * Tenant API key scopes required:
 *   devices:write, users:write, verifications:write, attendance:write
 *
 * The client is intentionally tolerant: when the central API is
 * unreachable or returns a non-2xx, it logs and returns null instead of
 * throwing. The demo flow continues. The premise is that the central
 * sync is observability for the dashboard, not the demo's ground
 * truth — the operator should still see the local "login ok" state
 * even if the network blips.
 */

import { hostname as osHostname } from 'node:os';

export interface CentralApiConfig {
  baseUrl: string;
  apiKey: string;
  deviceExternalId: string;
  deviceName: string;
  timeoutMs: number;
}

/** Build a config from process.env, or null when not enabled. */
export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CentralApiConfig | null {
  const baseUrl = (env.ZA_CENTRAL_API_URL ?? '').trim().replace(/\/+$/, '');
  const apiKey = (env.ZA_CENTRAL_API_KEY ?? '').trim();
  if (!baseUrl || !apiKey) return null;

  const deviceExternalId =
    (env.ZA_CENTRAL_DEVICE_ID ?? '').trim() || `iot-bridge-${osHostname()}`;
  const deviceName = (env.ZA_CENTRAL_DEVICE_NAME ?? '').trim() || 'IoT bridge';

  const parsedTimeout = Number.parseInt(env.ZA_CENTRAL_API_TIMEOUT_MS ?? '5000', 10);
  const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 5000;

  return { baseUrl, apiKey, deviceExternalId, deviceName, timeoutMs };
}

export interface DeviceRecord { id: string; external_id: string }
export interface UserRecord { id: string; external_id: string; full_name: string }
export interface VerificationRecord { id: string; method: string; result: string }
export interface AttendanceRecord { id: string; event_type: string; result: string }

type FetchLike = typeof fetch;
type LoggerLike = Pick<Console, 'info' | 'warn' | 'error'>;

export class CentralApiClient {
  private readonly cfg: CentralApiConfig;
  private readonly fetchImpl: FetchLike;
  private readonly log: LoggerLike;
  private deviceCache: DeviceRecord | null = null;

  constructor(
    cfg: CentralApiConfig,
    opts: { fetchImpl?: FetchLike; logger?: LoggerLike } = {},
  ) {
    this.cfg = cfg;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.log = opts.logger ?? console;
  }

  /**
   * Resolve a device record for this bridge instance. Idempotent: if a
   * device with the configured externalId already exists, the API
   * returns 409, and we list devices to pick it up. The result is
   * cached for the bridge's lifetime — we only call /v1/devices once.
   */
  async ensureDevice(): Promise<DeviceRecord | null> {
    if (this.deviceCache) return this.deviceCache;

    const created = await this.request<{ device: DeviceRecord }>('POST', '/v1/devices', {
      name: this.cfg.deviceName,
      externalId: this.cfg.deviceExternalId,
      metadata: { source: 'iot-bridge' },
    }, { expect: [201, 409] });

    if (created?.status === 201 && created.body?.device) {
      this.deviceCache = created.body.device;
      this.log.info(`[central-api] device created id=${this.deviceCache.id}`);
      return this.deviceCache;
    }

    // 409 — already registered. Look it up by listing + filter.
    const list = await this.request<{ devices: DeviceRecord[] }>('GET', '/v1/devices?limit=200', null, { expect: [200] });
    if (!list?.body?.devices) return null;
    const found = list.body.devices.find(d => d.external_id === this.cfg.deviceExternalId);
    if (found) {
      this.deviceCache = found;
      this.log.info(`[central-api] device resolved id=${found.id}`);
      return found;
    }
    this.log.warn(`[central-api] device ${this.cfg.deviceExternalId} not found after 409`);
    return null;
  }

  /**
   * Register the freshly-enrolled user under the bridge's tenant.
   * `externalId` is the email (the local demo uses email as identity);
   * the central record is fullName-required but we accept the email
   * itself as the display name to keep the demo single-field.
   */
  async registerUser(email: string): Promise<UserRecord | null> {
    const res = await this.request<{ user: UserRecord }>('POST', '/v1/users', {
      fullName: email,
      externalId: email,
      email,
      metadata: { source: 'iot-bridge' },
    }, { expect: [201, 409] });

    if (res?.status === 201 && res.body?.user) return res.body.user;

    if (res?.status === 409) {
      // Already exists — look it up.
      const list = await this.request<{ users: UserRecord[] }>(
        'GET',
        `/v1/users?limit=200`,
        null,
        { expect: [200] },
      );
      return list?.body?.users.find(u => u.external_id === email) ?? null;
    }

    return null;
  }

  async recordVerification(input: {
    userId: string;
    deviceId: string;
    method: 'fingerprint' | 'zkp';
    result: 'pass' | 'fail';
    confidenceScore?: number;
    referenceId?: string;
  }): Promise<VerificationRecord | null> {
    const res = await this.request<{ verification: VerificationRecord }>('POST', '/v1/verifications', input, {
      expect: [201],
    });
    return res?.body?.verification ?? null;
  }

  async recordCheckIn(input: {
    userId: string;
    deviceId: string;
    verificationId?: string;
    type: 'check_in' | 'check_out';
    result: 'accepted' | 'rejected';
  }): Promise<AttendanceRecord | null> {
    const res = await this.request<{ attendance: AttendanceRecord }>('POST', '/v1/attendance', input, {
      expect: [201],
    });
    return res?.body?.attendance ?? null;
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body: unknown,
    opts: { expect: number[] },
  ): Promise<{ status: number; body: T | null } | null> {
    const url = `${this.cfg.baseUrl}${path}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method,
        headers: {
          'Authorization': `Bearer ${this.cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: body == null ? undefined : JSON.stringify(body),
        signal: ctl.signal,
      });
      let parsed: unknown = null;
      const text = await res.text();
      if (text.length > 0) {
        try { parsed = JSON.parse(text); } catch { /* leave null */ }
      }
      if (!opts.expect.includes(res.status)) {
        this.log.warn(
          `[central-api] ${method} ${path} returned ${res.status} (expected ${opts.expect.join('|')})`,
        );
        return { status: res.status, body: null };
      }
      return { status: res.status, body: parsed as T };
    } catch (err) {
      const reason = (err as Error).name === 'AbortError' ? 'timeout' : (err as Error).message;
      this.log.warn(`[central-api] ${method} ${path} failed: ${reason}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
