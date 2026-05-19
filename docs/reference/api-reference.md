# API Reference

ZeroAuth is a hosted API. No packages to install — authenticate with an API key and make HTTP calls.

## Base URL

```
https://zeroauth.dev
```

## Authentication

All `/v1/*` endpoints require an API key:

```bash
# Option A: Authorization header (recommended)
-H "Authorization: Bearer za_live_YOUR_KEY"

# Option B: X-API-Key header
-H "X-API-Key: za_live_YOUR_KEY"
```

Get your API key: [Quickstart -> Step 1](../getting-started/quickstart.md)

For the reusable Week 1 product core, see [Central API](central-api.md).

## Response Headers

Every authenticated response includes rate limit info:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 97
X-RateLimit-Reset: 1710412800
X-ZeroAuth-Tenant: a1b2c3d4-...
X-ZeroAuth-Plan: free
```

---

## ZKP Authentication

### `POST /v1/auth/zkp/register`

Register a new biometric identity. The biometric template is processed on the server, a Poseidon commitment is generated, and the template is immediately discarded.

**Required scope:** `zkp:register`

**Request:**

```bash
curl -X POST https://api.zeroauth.dev/v1/auth/zkp/register \
  -H "Authorization: Bearer za_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"biometricTemplate": "BASE64_ENCODED_DATA"}'
```

**Response (201):**

```json
{
  "did": "did:zeroauth:base:8f3ac2d1...",
  "commitment": "12345678901234567890",
  "didHash": "98765432109876543210",
  "biometricSecret": "11111111111111111111",
  "salt": "22222222222222222222",
  "txHash": "0xabc123...",
  "blockNumber": 38817143,
  "dataStored": false,
  "message": "Identity registered. Store biometricSecret and salt securely on the client."
}
```

**Errors:** `400` invalid template, `401` bad API key, `403` insufficient scope, `429` rate limited

---

### `POST /v1/auth/zkp/verify`

Verify a Groth16 zero-knowledge proof and issue session tokens.

**Required scope:** `zkp:verify`

**Request:**

```bash
curl -X POST https://api.zeroauth.dev/v1/auth/zkp/verify \
  -H "Authorization: Bearer za_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "proof": {
      "pi_a": ["1", "2", "1"],
      "pi_b": [["1", "2"], ["3", "4"], ["1", "0"]],
      "pi_c": ["5", "6", "1"],
      "protocol": "groth16",
      "curve": "bn128"
    },
    "publicSignals": ["<commitment>", "<didHash>", "<identityBinding>"],
    "nonce": "8eb8b0db-c143-4e29-8e6c-6c26078ba2c8",
    "timestamp": "2026-03-14T10:30:00.000Z"
  }'
```

**Response (200):**

```json
{
  "accessToken": "eyJhbGci...",
  "refreshToken": "eyJhbGci...",
  "tokenType": "Bearer",
  "expiresIn": 3600,
  "verified": true,
  "sessionId": "6e92d480-...",
  "provider": "zkp",
  "dataStorageConfirmation": {
    "biometricDataStored": false,
    "message": "Zero biometric data stored. Ever."
  }
}
```

**Errors:** `401` proof failed or bad API key, `429` rate limited

**Validation rules:**
- Timestamp must be within 5 minutes of server time
- Nonce must be UUID v4 format
- publicSignals must contain exactly 3 elements

---

### `GET /v1/auth/zkp/nonce`

Generate a fresh nonce for client-side proof generation.

**Required scope:** `nonce:create`

```bash
curl https://api.zeroauth.dev/v1/auth/zkp/nonce \
  -H "Authorization: Bearer za_live_YOUR_KEY"
```

**Response:**

```json
{
  "nonce": "8eb8b0db-c143-4e29-8e6c-6c26078ba2c8",
  "timestamp": "2026-03-14T10:30:00.000Z",
  "expiresIn": 300
}
```

---

### `GET /v1/auth/zkp/circuit-info`

Returns circuit metadata for client-side proof generation setup.

**Required scope:** `zkp:verify`

```bash
curl https://api.zeroauth.dev/v1/auth/zkp/circuit-info \
  -H "Authorization: Bearer za_live_YOUR_KEY"
```

**Response:**

```json
{
  "circuit": "identity_proof",
  "protocol": "groth16",
  "curve": "bn128",
  "wasmPath": "circuits/build/identity_proof_js/identity_proof.wasm",
  "vkeyAvailable": true,
  "verifyOnChain": false,
  "publicInputs": ["commitment", "didHash", "identityBinding"],
  "privateInputs": ["biometricSecret", "salt"]
}
```

---

## SAML SSO

### `GET /v1/auth/saml/login`

Initiate SAML SSO flow.

**Required scope:** `saml:login`

```bash
curl https://api.zeroauth.dev/v1/auth/saml/login \
  -H "Authorization: Bearer za_live_YOUR_KEY"
```

### `POST /v1/auth/saml/callback`

Process SAML assertion from IdP. Returns session tokens.

**Required scope:** `saml:callback`

### `GET /v1/auth/saml/metadata`

Returns SP metadata XML for IdP configuration.

**Required scope:** `saml:login`

---

## OIDC / OAuth 2.0

### `GET /v1/auth/oidc/authorize`

Initiate OIDC authorization code flow with PKCE.

**Required scope:** `oidc:authorize`

```bash
curl https://api.zeroauth.dev/v1/auth/oidc/authorize \
  -H "Authorization: Bearer za_live_YOUR_KEY"
```

### `POST /v1/auth/oidc/callback`

Handle OIDC authorization code callback. Returns session tokens.

**Required scope:** `oidc:callback`

---

## Identity & Sessions

### `GET /v1/identity/me`

Get the authenticated user's profile from a session token.

**Required scope:** `identity:read`

**Additional header:** `X-Session-Token: <access_token from verify response>`

```bash
curl https://api.zeroauth.dev/v1/identity/me \
  -H "Authorization: Bearer za_live_YOUR_KEY" \
  -H "X-Session-Token: eyJhbGci..."
```

### `POST /v1/identity/logout`

Invalidate a user's session.

**Required scope:** `identity:read`

### `POST /v1/identity/refresh`

Refresh a user's session tokens.

**Required scope:** `identity:read`

**Body:** `{ "refreshToken": "eyJhbGci..." }`

---

## Developer Console

These endpoints manage your ZeroAuth account. They use console session tokens, not API keys.

### `POST /api/console/signup`

Create a developer account. Returns console token + first API key.

```json
{ "email": "dev@co.com", "password": "secure123", "companyName": "Co" }
```

### `POST /api/console/login`

Authenticate. Returns console token.

```json
{ "email": "dev@co.com", "password": "secure123" }
```

### `GET /api/console/keys`

List all API keys (active + revoked). Requires console token.

### `POST /api/console/keys`

Create a new API key. Requires console token.

```json
{ "name": "Production", "environment": "live", "scopes": ["zkp:verify"] }
```

### `DELETE /api/console/keys/:keyId`

Revoke an API key. Irreversible. Requires console token.

### `GET /api/console/usage`

Get usage summary, monthly history, and recent API calls.

### `GET /api/console/account`

Get current account info (plan, limits, status).

---

## Health

### `GET /api/health`

No authentication required. Returns service status and subsystem health.

---

## Error Format

All errors follow a consistent format:

```json
{
  "error": "error_code",
  "message": "Human-readable description",
  "docs": "/docs/relevant-page"
}
```

Common error codes:

| Code | HTTP | Description |
|---|---|---|
| `missing_api_key` | 401 | No API key provided |
| `invalid_api_key` | 401 | Key is invalid, expired, or revoked |
| `insufficient_scopes` | 403 | Key lacks required permissions |
| `tenant_inactive` | 403 | Account suspended or deactivated |
| `rate_limit_exceeded` | 429 | Too many requests |
| `monthly_quota_exceeded` | 429 | Monthly quota exhausted |
| `proof_verification_failed` | 401 | ZK proof did not verify |
