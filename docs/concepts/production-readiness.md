# Platform Capabilities

This page describes the current capabilities and roadmap of the ZeroAuth platform.

## Production-Ready Features

- **ZKP biometric authentication** — Full Groth16 proof verification with Poseidon commitments
- **Multi-tenant API platform** — Scoped API keys, per-tenant rate limiting, usage metering
- **API key lifecycle** — Create, list, revoke keys with SHA-256 hashed storage
- **Developer console** — Account management, key management, usage monitoring
- **JWT session management** — Access tokens, refresh tokens, session invalidation
- **Base Sepolia blockchain integration** — On-chain DID registry and proof verification
- **Enterprise federation endpoints** — SAML 2.0 and OIDC/OAuth 2.0 authentication paths
- **Plan-based limits** — Free, Starter, Growth, and Enterprise tiers with configurable quotas
- **Security middleware** — helmet, CORS, PKCE, scoped permissions

## API Endpoints

All authentication and identity endpoints are available under the `/v1/` versioned API:

| Category | Endpoints | Status |
|---|---|---|
| ZKP Authentication | register, verify, nonce, circuit-info | Production |
| SAML SSO | login, callback, metadata | Available |
| OIDC / OAuth 2.0 | authorize, callback | Available |
| Identity | me, logout, refresh | Production |
| Developer Console | signup, login, keys, usage, account | Production |
| Health | health check | Production |

## Integration Model

ZeroAuth is a hosted API platform. Integration requires:

1. **Sign up** at `https://api.zeroauth.dev/api/console/signup`
2. **Get an API key** — shown once at creation, stored as SHA-256 hash
3. **Make API calls** with `Authorization: Bearer za_live_YOUR_KEY`
4. **Monitor usage** via the developer console API

No packages to install. No infrastructure to manage. No biometric data stored.

## Plans

| Feature | Free | Starter | Growth | Enterprise |
|---|---|---|---|---|
| Monthly requests | 1,000 | 25,000 | 250,000 | Unlimited |
| Rate limit (per 15 min) | 100 | 500 | 2,000 | 10,000 |
| API keys | 10 | 10 | 10 | 10 |
| On-chain verification | -- | Yes | Yes | Yes |
| Support | Community | Email | Priority | Dedicated |

## Security Architecture

- API keys stored as SHA-256 hashes (raw key shown once)
- Tenant passwords hashed with scrypt
- Per-tenant sliding window rate limiting
- Monthly quota enforcement
- Scope-based API key permissions
- Zero biometric data persistence
- On-chain data limited to irreversible SHA-256 hashes

For the full security model, see [Privacy and Security](privacy-and-security.md).
