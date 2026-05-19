/**
 * Typed fetch client for the ZeroAuth console + v1 APIs.
 *
 * Console endpoints use a 24h JWT, returned from /api/console/login or
 * /api/console/signup. v1 endpoints use a tenant API key — those are not
 * stored in the dashboard; the dashboard talks to the console surface, and
 * the console surface (server-side) is what actually owns the tenant data.
 *
 * The JWT lives in localStorage under `zeroauth.console_token`. We rotate
 * + drop it on logout. There is no refresh-token flow for the console
 * session today — when it expires (24h) the user logs in again.
 */

const CONSOLE_TOKEN_KEY = 'zeroauth.console_token';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function readToken(): string | null {
  try {
    return localStorage.getItem(CONSOLE_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(CONSOLE_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(CONSOLE_TOKEN_KEY);
    }
  } catch {
    /* ignore — private mode / disabled storage */
  }
}

export function getToken(): string | null {
  return readToken();
}

type RequestOpts = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  auth?: boolean; // default true — attach the console JWT
  signal?: AbortSignal;
};

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    query,
    auth = true,
    signal,
  } = opts;

  const url = new URL(path, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (auth) {
    const token = readToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  // Parse body (best-effort). Empty responses (204) and non-JSON 5xxs are OK.
  let parsed: unknown = undefined;
  const text = await res.text();
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const errBody = (parsed && typeof parsed === 'object' ? parsed : {}) as {
      error?: string;
      message?: string;
    };
    const code = errBody.error ?? `http_${res.status}`;
    const msg = errBody.message ?? res.statusText ?? 'Request failed';

    // 401 from the console means our token is gone or expired — purge it
    // so the next render kicks the user to /login.
    if (res.status === 401 && path.startsWith('/api/console/')) {
      setToken(null);
    }

    throw new ApiError(res.status, code, msg, parsed);
  }

  return parsed as T;
}

// ─── Console types ───────────────────────────────────────────────

export type Plan = 'free' | 'starter' | 'growth' | 'enterprise';
export type Environment = 'live' | 'test';

export interface Tenant {
  id: string;
  email: string;
  companyName: string | null;
  plan: Plan;
  status: 'active' | 'suspended' | 'deactivated';
}

/**
 * F-2 v2 byte-identical signup response (issue #27).
 *
 * POST /api/console/signup always returns 202 with this shape regardless
 * of whether the email is taken. The dashboard reads `status` to render
 * the "check your inbox" state. The actual account + API key are minted
 * only after the user clicks the verification link, at which point the
 * GET /api/console/verify-signup endpoint sets a one-shot reveal cookie
 * and redirects to /dashboard/signup-complete.
 */
export interface SignupResponse {
  status: 'pending_verification';
  message: string;
}

/**
 * Payload set by the backend at verify-signup time and read once by the
 * SignupComplete page. Source: the `zeroauth_signup_reveal` cookie,
 * base64url-encoded JSON. Cleared after the page reads it.
 */
export interface SignupRevealPayload {
  token: string;
  apiKey: string;
  apiKeyId: string;
  apiKeyName: string;
  apiKeyPrefix: string;
  apiKeyEnv: Environment;
}

export interface LoginResponse {
  token: string;
  tenant: Tenant;
}

export interface Account {
  id: string;
  email: string;
  companyName: string | null;
  plan: Plan;
  status: 'active' | 'suspended' | 'deactivated';
  rateLimit: number;
  monthlyQuota: number;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  environment: Environment;
  status: 'active' | 'revoked';
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface ApiKeyCreateResponse {
  key: string;
  id: string;
  name: string;
  prefix: string;
  environment: Environment;
  scopes: string[];
  createdAt: string;
  warning: string;
}

export interface UsageSummary {
  plan: Plan;
  currentMonth: {
    used: number;
    limit: number;
    remaining: number | 'unlimited';
  };
  rateLimit: { requestsPer15Min: number };
  history: Array<{
    period: string;
    total_requests: number;
    zkp_verifications: number;
    zkp_registrations: number;
    saml_auths: number;
    oidc_auths: number;
  }>;
  recentCalls: Array<{
    id: string | number;
    endpoint: string;
    method: string;
    status_code: number;
    response_time_ms: number | null;
    created_at: string;
  }>;
}

export interface Device {
  id: string;
  external_id: string;
  name: string;
  location_id: string | null;
  status: 'active' | 'inactive' | 'retired';
  battery_level: number | null;
  metadata: Record<string, unknown>;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  external_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  employee_code: string | null;
  status: 'active' | 'inactive';
  primary_device_id: string | null;
  metadata: Record<string, unknown>;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Verification {
  id: string;
  user_id: string | null;
  device_id: string | null;
  method: 'zkp' | 'fingerprint' | 'face' | 'depth' | 'saml' | 'oidc' | 'manual';
  result: 'pass' | 'fail' | 'challenge';
  reason: string | null;
  confidence_score: number | null;
  reference_id: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
}

export interface AttendanceEvent {
  id: string;
  user_id: string;
  device_id: string | null;
  verification_id: string | null;
  event_type: 'check_in' | 'check_out';
  result: 'accepted' | 'rejected';
  metadata: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
}

export interface AuditEvent {
  id: number;
  environment: Environment | null;
  actor_type: 'api_key' | 'console' | 'device' | 'system';
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  status: 'success' | 'failure';
  summary: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ConsoleOverview {
  environment: Environment;
  counts: {
    devices: number;
    users: number;
    verifications: number;
    attendanceEvents: number;
    auditEvents: number;
  };
  recentDevices: Device[];
  recentUsers: User[];
  recentVerifications: Verification[];
  recentAttendance: AttendanceEvent[];
  recentAuditEvents: AuditEvent[];
}

// ─── API call helpers ────────────────────────────────────────────

export const api = {
  // Auth
  signup: (input: { email: string; password: string; companyName?: string }) =>
    request<SignupResponse>('/api/console/signup', { method: 'POST', body: input, auth: false }),

  login: (input: { email: string; password: string }) =>
    request<LoginResponse>('/api/console/login', { method: 'POST', body: input, auth: false }),

  // Account + usage
  account: () => request<Account>('/api/console/account'),
  usage: () => request<UsageSummary>('/api/console/usage'),

  // Overview + audit
  overview: (environment: Environment) =>
    request<ConsoleOverview>('/api/console/overview', { query: { environment } }),
  audit: (params: { environment: Environment; action?: string; status?: 'success' | 'failure'; limit?: number }) =>
    request<{ environment: Environment; events: AuditEvent[] }>('/api/console/audit', { query: params }),

  // API keys
  listKeys: () => request<{ keys: ApiKey[] }>('/api/console/keys'),
  createKey: (input: { name?: string; environment?: Environment; scopes?: string[] }) =>
    request<ApiKeyCreateResponse>('/api/console/keys', { method: 'POST', body: input }),
  revokeKey: (keyId: string) =>
    request<{ message: string; keyId: string }>(`/api/console/keys/${encodeURIComponent(keyId)}`, { method: 'DELETE' }),

  // Devices — console proxies live at /api/console/devices
  listDevices: (params: { environment: Environment; status?: Device['status']; limit?: number }) =>
    request<{ environment: Environment; devices: Device[] }>('/api/console/devices', { query: params }),
  createDevice: (input: {
    environment: Environment;
    name: string;
    externalId?: string;
    locationId?: string;
    batteryLevel?: number;
    metadata?: Record<string, unknown>;
  }) => request<{ environment: Environment; device: Device }>('/api/console/devices', { method: 'POST', body: input }),
  updateDevice: (
    deviceId: string,
    input: {
      environment: Environment;
      name?: string;
      locationId?: string;
      batteryLevel?: number;
      status?: Device['status'];
      metadata?: Record<string, unknown>;
      lastSeenAt?: string;
    },
  ) => request<{ environment: Environment; device: Device }>(`/api/console/devices/${encodeURIComponent(deviceId)}`, { method: 'PATCH', body: input }),

  // Users
  listUsers: (params: { environment: Environment; status?: User['status']; limit?: number }) =>
    request<{ environment: Environment; users: User[] }>('/api/console/users', { query: params }),
  createUser: (input: {
    environment: Environment;
    fullName: string;
    externalId?: string;
    email?: string;
    phone?: string;
    employeeCode?: string;
    primaryDeviceId?: string;
    metadata?: Record<string, unknown>;
  }) => request<{ environment: Environment; user: User }>('/api/console/users', { method: 'POST', body: input }),
  updateUser: (
    userId: string,
    input: {
      environment: Environment;
      fullName?: string;
      email?: string;
      phone?: string;
      employeeCode?: string;
      status?: User['status'];
      primaryDeviceId?: string;
      metadata?: Record<string, unknown>;
    },
  ) => request<{ environment: Environment; user: User }>(`/api/console/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: input }),

  // Verifications (read-only on the console)
  listVerifications: (params: { environment: Environment; method?: Verification['method']; result?: Verification['result']; limit?: number }) =>
    request<{ environment: Environment; verifications: Verification[] }>('/api/console/verifications', { query: params }),

  // Attendance (read-only on the console)
  listAttendance: (params: { environment: Environment; type?: AttendanceEvent['event_type']; result?: AttendanceEvent['result']; limit?: number }) =>
    request<{ environment: Environment; attendance: AttendanceEvent[] }>('/api/console/attendance', { query: params }),
};
