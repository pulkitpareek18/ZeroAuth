# Configuration

ZeroAuth is a hosted API — there is nothing to install or configure on your servers. All you need is an API key.

## Getting Started

1. [Sign up](https://api.zeroauth.dev/api/console/signup) for a ZeroAuth account.
2. Copy your API key (shown once at signup).
3. Add your API key to your application's environment:

```bash
# In your .env file or environment
ZEROAUTH_API_KEY=za_live_YOUR_KEY_HERE
```

4. Make API calls to `https://api.zeroauth.dev/v1/*`.

## API Key Configuration

### Passing Your API Key

Use one of two methods in every request:

```bash
# Option A: Authorization header (recommended)
curl https://api.zeroauth.dev/v1/auth/zkp/nonce \
  -H "Authorization: Bearer za_live_YOUR_KEY"

# Option B: X-API-Key header
curl https://api.zeroauth.dev/v1/auth/zkp/nonce \
  -H "X-API-Key: za_live_YOUR_KEY"
```

### Scoping Keys

When creating additional API keys, restrict scopes to only what each service needs:

```bash
# Backend that only verifies proofs
curl -X POST https://api.zeroauth.dev/api/console/keys \
  -H "Authorization: Bearer YOUR_CONSOLE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Verification Service",
    "scopes": ["zkp:verify", "nonce:create"]
  }'
```

See [API Keys](./api-keys.md) for the full list of available scopes.

### Environment Separation

Use separate keys for development and production:

- `za_test_...` keys for development and testing (not metered)
- `za_live_...` keys for production (metered against your plan quota)

## Integration Patterns

### Server-Side Integration

Your backend calls ZeroAuth APIs directly:

```
Your Backend  -->  https://api.zeroauth.dev/v1/*
```

Store the API key as a server-side environment variable. Never expose it to the browser.

### Client + Server Pattern

For ZKP flows, proof generation happens on the client, but verification goes through your backend:

```
1. Client captures biometric
2. Client generates ZK proof locally (using snarkjs + circuit artifacts)
3. Client sends proof to YOUR backend
4. Your backend forwards proof to ZeroAuth API for verification
5. ZeroAuth returns session tokens to your backend
6. Your backend establishes the user's session
```

This pattern keeps your API key server-side while letting the client handle proof generation.

### SAML / OIDC Integration

For enterprise SSO, your application redirects users through ZeroAuth's federation endpoints:

```
1. Your app calls GET /v1/auth/saml/login (or /v1/auth/oidc/authorize)
2. ZeroAuth returns the IdP redirect URL
3. User authenticates with their IdP
4. IdP posts back to ZeroAuth's callback
5. ZeroAuth issues session tokens
```

## Rate Limits and Quotas

Every response includes rate limit headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 97
X-RateLimit-Reset: 1710412800
X-ZeroAuth-Plan: free
```

Limits are per-tenant (not per-key):

| Plan | Rate Limit (per 15 min) | Monthly Quota |
|---|---|---|
| Free | 100 | 1,000 |
| Starter | 500 | 25,000 |
| Growth | 2,000 | 250,000 |
| Enterprise | 10,000 | Unlimited |

Monitor your usage:

```bash
curl https://api.zeroauth.dev/api/console/usage \
  -H "Authorization: Bearer YOUR_CONSOLE_TOKEN"
```

## On-Chain Verification

ZeroAuth can optionally anchor identities on the Base Sepolia L2 blockchain. When blockchain integration is enabled for your account:

- Identity registrations are anchored on-chain via the `DIDRegistry` contract.
- Proof verification can include an optional on-chain verification step.

On-chain verification is available on Starter plans and above. Contact support to enable it for your account.

## Next Steps

- [Quickstart](./quickstart.md) — Create your account and make your first call
- [API Keys](./api-keys.md) — Key management, scopes, and rotation
- [API Reference](../reference/api-reference.md) — Full endpoint documentation
