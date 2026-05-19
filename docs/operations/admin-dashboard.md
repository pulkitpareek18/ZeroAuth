# Developer Console

The ZeroAuth Developer Console provides API key management, usage monitoring, and account administration through a REST API.

## Console Authentication

Console endpoints use session tokens (not API keys). Get a console token by logging in:

```bash
curl -X POST https://api.zeroauth.dev/api/console/login \
  -H "Content-Type: application/json" \
  -d '{"email": "dev@yourcompany.com", "password": "your-password"}'
```

Response:

```json
{
  "token": "eyJhbGci...",
  "tenant": {
    "id": "a1b2c3d4-...",
    "email": "dev@yourcompany.com",
    "plan": "free"
  }
}
```

Use the token in subsequent console requests:

```
Authorization: Bearer <console_token>
```

Console tokens expire after 24 hours.

## API Key Management

### List Keys

```bash
curl https://api.zeroauth.dev/api/console/keys \
  -H "Authorization: Bearer YOUR_CONSOLE_TOKEN"
```

Returns all keys (active and revoked) with prefix, scopes, environment, and last used timestamp. The raw key value is never returned.

### Create a Key

```bash
curl -X POST https://api.zeroauth.dev/api/console/keys \
  -H "Authorization: Bearer YOUR_CONSOLE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production Backend",
    "environment": "live",
    "scopes": ["zkp:verify", "zkp:register", "nonce:create"]
  }'
```

The raw API key is shown **exactly once** in the response. Copy it immediately.

### Revoke a Key

```bash
curl -X DELETE https://api.zeroauth.dev/api/console/keys/KEY_UUID \
  -H "Authorization: Bearer YOUR_CONSOLE_TOKEN"
```

Revocation is immediate and irreversible. Maximum 10 active keys per account.

## Usage Monitoring

### Usage Summary

```bash
curl https://api.zeroauth.dev/api/console/usage \
  -H "Authorization: Bearer YOUR_CONSOLE_TOKEN"
```

Returns:

```json
{
  "plan": "free",
  "currentMonth": {
    "used": 142,
    "limit": 1000,
    "remaining": 858
  },
  "rateLimit": {
    "requestsPer15Min": 100
  },
  "history": [...],
  "recentCalls": [...]
}
```

### Account Info

```bash
curl https://api.zeroauth.dev/api/console/account \
  -H "Authorization: Bearer YOUR_CONSOLE_TOKEN"
```

Returns plan tier, rate limit, monthly quota, and account status.

## What the Console Tracks

- **Per-tenant usage** — All API calls metered against your monthly quota
- **Rate limit status** — Sliding window rate limiting per 15-minute period
- **API key activity** — Last used timestamps for each key
- **Monthly history** — Usage trends over time
- **Recent calls** — Last 50 API calls with endpoint, status, and timestamp

## Console vs. API Keys

| Feature | Console Token | API Key |
|---|---|---|
| **Used for** | Account management | API calls |
| **Prefix** | JWT (`eyJ...`) | `za_live_...` or `za_test_...` |
| **Expiry** | 24 hours | Until revoked |
| **Endpoints** | `/api/console/*` | `/v1/*` |
| **Obtained via** | Login or signup | Console API |

For more details on API keys, see [API Keys](../getting-started/api-keys.md).
