# Quickstart

Get ZeroAuth running in under 5 minutes. No packages to install — just API calls.

## Step 1: Create Your Account

```bash
curl -X POST https://api.zeroauth.dev/api/console/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "dev@yourcompany.com",
    "password": "your-secure-password",
    "companyName": "Your Company"
  }'
```

Response:

```json
{
  "token": "eyJhbGci...",
  "tenant": {
    "id": "a1b2c3d4-...",
    "email": "dev@yourcompany.com",
    "plan": "free"
  },
  "apiKey": {
    "key": "za_live_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6",
    "warning": "Copy this API key now — it will never be shown again."
  }
}
```

:::caution
Copy your API key immediately. It is displayed only once at creation time.
The server stores only a SHA-256 hash — the raw key is never persisted.
:::

## Step 2: Make Your First API Call

### Register a Device

```bash
curl -X POST https://api.zeroauth.dev/v1/devices \
  -H "Authorization: Bearer za_live_YOUR_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Front Desk Attendance Unit",
    "externalId": "iot-blr-hq-01",
    "locationId": "blr-hq",
    "batteryLevel": 94
  }'
```

### Create an Enrolled User

```bash
curl -X POST https://api.zeroauth.dev/v1/users \
  -H "Authorization: Bearer za_live_YOUR_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Aditi Sharma",
    "externalId": "emp-001",
    "employeeCode": "ZS-001"
  }'
```

### Get a Nonce for ZKP

```bash
curl https://api.zeroauth.dev/v1/auth/zkp/nonce \
  -H "Authorization: Bearer za_live_YOUR_KEY_HERE"
```

```json
{
  "nonce": "8eb8b0db-c143-4e29-8e6c-6c26078ba2c8",
  "timestamp": "2026-03-14T10:30:00.000Z",
  "expiresIn": 300
}
```

### Register an Identity

```bash
curl -X POST https://api.zeroauth.dev/v1/auth/zkp/register \
  -H "Authorization: Bearer za_live_YOUR_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{"biometricTemplate": "BASE64_ENCODED_BIOMETRIC_DATA"}'
```

### Verify a ZK Proof

```bash
curl -X POST https://api.zeroauth.dev/v1/auth/zkp/verify \
  -H "Authorization: Bearer za_live_YOUR_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "proof": {
      "pi_a": ["1", "2", "1"],
      "pi_b": [["1", "2"], ["3", "4"], ["1", "0"]],
      "pi_c": ["5", "6", "1"],
      "protocol": "groth16",
      "curve": "bn128"
    },
    "publicSignals": ["<commitment>", "<didHash>", "<binding>"],
    "nonce": "8eb8b0db-c143-4e29-8e6c-6c26078ba2c8",
    "timestamp": "2026-03-14T10:30:00.000Z"
  }'
```

### Record a Verification Event

```bash
curl -X POST https://api.zeroauth.dev/v1/verifications \
  -H "Authorization: Bearer za_live_YOUR_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "USER_UUID",
    "deviceId": "DEVICE_UUID",
    "method": "zkp",
    "result": "pass",
    "referenceId": "attendance-attempt-1001"
  }'
```

### Record Attendance

```bash
curl -X POST https://api.zeroauth.dev/v1/attendance \
  -H "Authorization: Bearer za_live_YOUR_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "USER_UUID",
    "deviceId": "DEVICE_UUID",
    "verificationId": "VERIFICATION_UUID",
    "type": "check_in"
  }'
```

## Step 3: Check Your Usage

```bash
curl https://api.zeroauth.dev/api/console/usage \
  -H "Authorization: Bearer YOUR_CONSOLE_TOKEN"
```

## Plans

| Feature | Free | Starter | Growth | Enterprise |
|---|---|---|---|---|
| Monthly requests | 1,000 | 25,000 | 250,000 | Unlimited |
| Rate limit (per 15 min) | 100 | 500 | 2,000 | 10,000 |
| API keys | 10 | 10 | 10 | 10 |
| ZKP verification | Yes | Yes | Yes | Yes |
| SAML SSO | Yes | Yes | Yes | Yes |
| OIDC/OAuth2 | Yes | Yes | Yes | Yes |
| On-chain verification | -- | Yes | Yes | Yes |
| Support | Community | Email | Priority | Dedicated |

## Authentication

All v1 API calls require your API key in the `Authorization` header:

```
Authorization: Bearer za_live_YOUR_KEY_HERE
```

Or via the `X-API-Key` header:

```
X-API-Key: za_live_YOUR_KEY_HERE
```

## Rate Limit Headers

Every response includes:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 97
X-RateLimit-Reset: 1710412800
X-ZeroAuth-Plan: free
```

## Next Steps

- [API Reference](../reference/api-reference.md) — Full endpoint documentation
- [Central API](../reference/central-api.md) — Devices, users, verifications, attendance, and audit
- [API Keys Guide](./api-keys.md) — Managing keys, scopes, and environments
- [Configuration](configuration.md) — Integration options
- [Architecture](../concepts/architecture.md) — How ZeroAuth works under the hood
