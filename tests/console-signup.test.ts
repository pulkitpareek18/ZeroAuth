/**
 * Integration tests for the F-2 v2 byte-identical signup mitigation
 * (issue #27). Asserts:
 *
 *   - POST /api/console/signup returns 202 + UNIFORM body whether the
 *     email is fresh or already registered (no enumeration via status
 *     or body)
 *   - Fresh email → pending_signups row created + verify-signup email
 *     fired to the address that signed up
 *   - Duplicate email → notice email fired to the LEGITIMATE holder
 *     (not the attacker) + NO tenant created + NO pending row
 *   - Password is scrypt-hashed on BOTH branches (timing equalization)
 *   - 400 paths (missing field, weak password) still 400 — those don't
 *     leak account existence
 *   - GET /api/console/verify-signup consumes a valid token, creates
 *     the real tenant + API key, and 303-redirects to a dashboard page
 *
 * The v1 partial-mitigation tests (201/409 split with timing burn)
 * are obsolete now that v2 is in place.
 */

const sendMailMock = jest.fn();
const createTenantMock = jest.fn();
const createTenantWithHashMock = jest.fn();
const hashPasswordMock = jest.fn();
const authenticateTenantMock = jest.fn();
const getTenantByIdMock = jest.fn();
const getTenantByEmailMock = jest.fn();
const createApiKeyMock = jest.fn();
const createPendingSignupMock = jest.fn();
const consumePendingSignupMock = jest.fn();

jest.mock('../src/services/email', () => ({
  sendMail: (...args: unknown[]) => sendMailMock(...args),
  _resetTransporterForTests: jest.fn(),
}));

jest.mock('../src/services/tenants', () => ({
  createTenant: (...args: unknown[]) => createTenantMock(...args),
  createTenantWithHash: (...args: unknown[]) => createTenantWithHashMock(...args),
  hashPassword: (...args: unknown[]) => hashPasswordMock(...args),
  authenticateTenant: (...args: unknown[]) => authenticateTenantMock(...args),
  getTenantById: (...args: unknown[]) => getTenantByIdMock(...args),
  getTenantByEmail: (...args: unknown[]) => getTenantByEmailMock(...args),
}));

jest.mock('../src/services/pending-signups', () => ({
  createPendingSignup: (...args: unknown[]) => createPendingSignupMock(...args),
  consumePendingSignup: (...args: unknown[]) => consumePendingSignupMock(...args),
  purgeExpiredPendingSignups: jest.fn(),
}));

jest.mock('../src/services/api-keys', () => ({
  createApiKey: (...args: unknown[]) => createApiKeyMock(...args),
  listApiKeys: jest.fn().mockResolvedValue([]),
  revokeApiKey: jest.fn(),
  countActiveKeys: jest.fn().mockResolvedValue(0),
}));

jest.mock('../src/services/platform', () => ({
  recordAuditEvent: jest.fn().mockResolvedValue(undefined),
  getConsoleOverview: jest.fn(),
  listAuditEvents: jest.fn(),
  createDevice: jest.fn(),
  listDevices: jest.fn(),
  updateDevice: jest.fn(),
  createTenantUser: jest.fn(),
  listTenantUsers: jest.fn(),
  updateTenantUser: jest.fn(),
  listVerificationEvents: jest.fn(),
  listAttendanceEvents: jest.fn(),
}));

jest.mock('../src/services/usage', () => ({
  getUsageSummary: jest.fn(),
  getRecentCalls: jest.fn(),
  getCurrentMonthUsage: jest.fn().mockResolvedValue(0),
}));

import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();

const VALID_PASSWORD = 'Aa1!stuvwxyz';

const UNIFORM_MESSAGE = /If this email isn't already registered, we've sent a verification link/;

describe('POST /api/console/signup — F-2 v2 byte-identical (issue #27)', () => {
  beforeEach(() => {
    sendMailMock.mockReset();
    createTenantMock.mockReset();
    createTenantWithHashMock.mockReset();
    hashPasswordMock.mockReset();
    getTenantByEmailMock.mockReset();
    createApiKeyMock.mockReset();
    createPendingSignupMock.mockReset();
    consumePendingSignupMock.mockReset();
    sendMailMock.mockResolvedValue({ ok: true, messageId: '<test>' });
    hashPasswordMock.mockResolvedValue('aabbccdd:eeff0011');
    createPendingSignupMock.mockResolvedValue({
      token: 'tok_abc123',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
  });

  describe('fresh email', () => {
    beforeEach(() => {
      getTenantByEmailMock.mockResolvedValue(null);
    });

    it('returns 202 with the uniform pending_verification body', async () => {
      const res = await request(app)
        .post('/api/console/signup')
        .send({ email: 'fresh@example.com', password: VALID_PASSWORD, companyName: 'Acme' });

      expect(res.status).toBe(202);
      expect(res.body.status).toBe('pending_verification');
      expect(res.body.message).toMatch(UNIFORM_MESSAGE);
      // No token / API key in the response — those leak on verify, not on signup.
      expect(res.body.token).toBeUndefined();
      expect(res.body.apiKey).toBeUndefined();
      expect(res.body.tenant).toBeUndefined();
    });

    it('hashes the password (timing equalization with the duplicate path)', async () => {
      await request(app)
        .post('/api/console/signup')
        .send({ email: 'fresh@example.com', password: VALID_PASSWORD });

      expect(hashPasswordMock).toHaveBeenCalledWith(VALID_PASSWORD);
    });

    it('parks the request in pending_signups with the hash + company', async () => {
      await request(app)
        .post('/api/console/signup')
        .send({ email: 'fresh@example.com', password: VALID_PASSWORD, companyName: 'Acme' });

      expect(createPendingSignupMock).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'fresh@example.com',
          passwordHash: 'aabbccdd:eeff0011',
          companyName: 'Acme',
        }),
      );
    });

    it('does NOT create the tenant or an API key yet', async () => {
      await request(app)
        .post('/api/console/signup')
        .send({ email: 'fresh@example.com', password: VALID_PASSWORD });

      expect(createTenantMock).not.toHaveBeenCalled();
      expect(createTenantWithHashMock).not.toHaveBeenCalled();
      expect(createApiKeyMock).not.toHaveBeenCalled();
    });

    it('fires the verify-signup email to the signing-up address with a verify URL', async () => {
      await request(app)
        .post('/api/console/signup')
        .send({ email: 'fresh@example.com', password: VALID_PASSWORD });

      await new Promise(resolve => setImmediate(resolve));

      expect(sendMailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'fresh@example.com',
          subject: expect.stringMatching(/Verify your ZeroAuth account/),
        }),
      );
      const call = sendMailMock.mock.calls[0];
      const body = call[0] as { html: string; text: string };
      expect(body.html).toContain('verify-signup?token=tok_abc123');
      expect(body.text).toContain('verify-signup?token=tok_abc123');
    });
  });

  describe('duplicate email', () => {
    beforeEach(() => {
      getTenantByEmailMock.mockResolvedValue({
        id: 'tenant-existing',
        email: 'existing@example.com',
      });
    });

    it('returns the SAME 202 + uniform body as the fresh path', async () => {
      const res = await request(app)
        .post('/api/console/signup')
        .send({ email: 'existing@example.com', password: VALID_PASSWORD });

      expect(res.status).toBe(202);
      expect(res.body.status).toBe('pending_verification');
      expect(res.body.message).toMatch(UNIFORM_MESSAGE);
    });

    it('fires the notice email to the LEGITIMATE holder', async () => {
      await request(app)
        .post('/api/console/signup')
        .send({ email: 'existing@example.com', password: VALID_PASSWORD });

      await new Promise(resolve => setImmediate(resolve));

      expect(sendMailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'existing@example.com',
          subject: expect.stringMatching(/Someone tried to sign up/i),
        }),
      );
    });

    it('does NOT park a pending signup and does NOT create a tenant', async () => {
      await request(app)
        .post('/api/console/signup')
        .send({ email: 'existing@example.com', password: VALID_PASSWORD });

      expect(createPendingSignupMock).not.toHaveBeenCalled();
      expect(createTenantMock).not.toHaveBeenCalled();
      expect(createTenantWithHashMock).not.toHaveBeenCalled();
    });

    it('hashes the password (timing parity with the fresh path)', async () => {
      await request(app)
        .post('/api/console/signup')
        .send({ email: 'existing@example.com', password: VALID_PASSWORD });

      expect(hashPasswordMock).toHaveBeenCalledWith(VALID_PASSWORD);
    });

    it('does NOT leak the existing tenant id in the response body', async () => {
      const res = await request(app)
        .post('/api/console/signup')
        .send({ email: 'existing@example.com', password: VALID_PASSWORD });
      expect(JSON.stringify(res.body)).not.toContain('tenant-existing');
    });
  });

  describe('invalid input — no enumeration via 400 path', () => {
    it('400 invalid_request when email is missing (no DB lookup, no email sent)', async () => {
      const res = await request(app)
        .post('/api/console/signup')
        .send({ password: VALID_PASSWORD });
      expect(res.status).toBe(400);
      expect(getTenantByEmailMock).not.toHaveBeenCalled();
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it('400 invalid_password when password is too short (no DB lookup)', async () => {
      const res = await request(app)
        .post('/api/console/signup')
        .send({ email: 'x@y.com', password: 'short' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_password');
      expect(getTenantByEmailMock).not.toHaveBeenCalled();
    });
  });
});

describe('GET /api/console/verify-signup — F-2 v2 second leg', () => {
  beforeEach(() => {
    sendMailMock.mockReset();
    consumePendingSignupMock.mockReset();
    getTenantByEmailMock.mockReset();
    createTenantWithHashMock.mockReset();
    createApiKeyMock.mockReset();
    sendMailMock.mockResolvedValue({ ok: true, messageId: '<test>' });
  });

  it('400s with HTML when the token query param is missing', async () => {
    const res = await request(app).get('/api/console/verify-signup');
    expect(res.status).toBe(400);
    expect(res.text).toContain('Missing or invalid verification token');
  });

  it('400s with HTML when the token is unknown / expired', async () => {
    consumePendingSignupMock.mockResolvedValue(null);
    const res = await request(app).get('/api/console/verify-signup?token=garbage');
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/invalid or has already been used/);
  });

  it('on success, consumes the token + creates the tenant + redirects to /dashboard/signup-complete', async () => {
    consumePendingSignupMock.mockResolvedValue({
      email: 'fresh@example.com',
      passwordHash: 'aabbccdd:eeff0011',
      companyName: 'Acme',
    });
    getTenantByEmailMock.mockResolvedValue(null);
    createTenantWithHashMock.mockResolvedValue({
      id: 'tenant-new',
      email: 'fresh@example.com',
      company_name: 'Acme',
      plan: 'free',
      status: 'active',
    });
    createApiKeyMock.mockResolvedValue({
      key: 'za_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      id: 'key-1',
      name: 'Default Live Key',
      key_prefix: 'za_live_aaaaaa',
      scopes: [],
      environment: 'live',
    });

    const res = await request(app).get('/api/console/verify-signup?token=tok_abc123');

    expect(consumePendingSignupMock).toHaveBeenCalledWith('tok_abc123');
    expect(createTenantWithHashMock).toHaveBeenCalledWith(
      'fresh@example.com',
      'aabbccdd:eeff0011',
      'Acme',
    );
    expect(createApiKeyMock).toHaveBeenCalledWith('tenant-new', 'Default Live Key', 'live');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/dashboard/signup-complete');
    // One-time reveal cookie is set so the dashboard can read it once.
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    expect(setCookie?.join(';')).toMatch(/zeroauth_signup_reveal=/);
  });

  it('on race (email got claimed between signup and verify), redirects to /dashboard/login?already_verified=1', async () => {
    consumePendingSignupMock.mockResolvedValue({
      email: 'fresh@example.com',
      passwordHash: 'aabbccdd:eeff0011',
      companyName: null,
    });
    getTenantByEmailMock.mockResolvedValue({ id: 'tenant-racy', email: 'fresh@example.com' });

    const res = await request(app).get('/api/console/verify-signup?token=tok_abc123');

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/dashboard/login?already_verified=1');
    expect(createTenantWithHashMock).not.toHaveBeenCalled();
  });
});
