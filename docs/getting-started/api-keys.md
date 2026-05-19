# API Keys

API keys authenticate your application's requests to ZeroAuth. Each key is scoped to your tenant account and tracks usage independently.

## Key Format

```
za_{environment}_{48 hex characters}
```

- `za_live_...` — Production keys (real verification, metered)
- `za_test_...` — Sandbox keys (test mode, not metered)

## Creating Keys

### At Signup

A default live key is automatically created when you sign up:

```bash
curl -X POST https://api.zeroauth.dev/api/console/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "dev@co.com", "password": "secure123"}'
```

### Additional Keys

Create additional keys via the console API:

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

Response:

```json
{
  "key": "za_live_a1b2c3d4...",
  "id": "uuid",
  "name": "Production Backend",
  "prefix": "za_live_a1b2c3",
  "environment": "live",
  "scopes": ["zkp:verify", "zkp:register", "nonce:create"],
  "warning": "Copy this API key now — it will never be shown again."
}
```

:::danger Important
The raw API key is shown **exactly once** at creation time. ZeroAuth stores only a SHA-256 hash of the key — it cannot be recovered. If you lose it, revoke and create a new one.
:::

## Scopes

Each key can be restricted to specific operations:

| Scope | Description |
|---|---|
| `zkp:verify` | Verify ZK proofs |
| `zkp:register` | Register new identities |
| `nonce:create` | Generate proof nonces |
| `identity:read` | Read user session/identity info |
| `saml:login` | Initiate SAML SSO flows |
| `saml:callback` | Process SAML assertions |
| `oidc:authorize` | Initiate OIDC flows |
| `oidc:callback` | Process OIDC callbacks |

Default scopes for new keys: `zkp:verify`, `zkp:register`, `identity:read`, `nonce:create`

## Listing Keys

```bash
curl https://api.zeroauth.dev/api/console/keys \
  -H "Authorization: Bearer YOUR_CONSOLE_TOKEN"
```

Returns all keys (active and revoked) with prefix, scopes, environment, and last used timestamp. The raw key is never returned.

## Revoking Keys

Revocation is immediate and irreversible:

```bash
curl -X DELETE https://api.zeroauth.dev/api/console/keys/KEY_UUID \
  -H "Authorization: Bearer YOUR_CONSOLE_TOKEN"
```

After revocation, any request using that key returns `401 invalid_api_key`.

## Security Best Practices

1. **Never commit keys to source control** — Use environment variables
2. **Use separate keys per environment** — `za_live_*` for production, `za_test_*` for development
3. **Restrict scopes** — Only grant the permissions each service needs
4. **Rotate regularly** — Create a new key, update your services, then revoke the old one
5. **Monitor usage** — Check `GET /api/console/usage` for anomalies

## Limits

- Maximum **10 active keys** per tenant account
- Keys can optionally have an expiration date (set at creation)
- Rate limits and quotas are applied per-tenant, not per-key
