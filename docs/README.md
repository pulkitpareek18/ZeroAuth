# ZeroAuth Documentation

ZeroAuth is a hosted authentication API that combines zero-knowledge biometric verification, enterprise federation (SAML, OIDC), and blockchain-anchored decentralized identity into a single platform.

No packages to install. Create an account at [zeroauth.dev](https://zeroauth.dev), get an API key, and start making requests.

## What ZeroAuth Does

ZeroAuth exposes three authentication paths through a unified REST API:

- **ZKP biometric auth** — Privacy-preserving proof-based verification. Zero biometric data stored. Ever.
- **SAML 2.0** — Enterprise SSO integration with identity providers.
- **OAuth 2.0 / OIDC** — Modern authorization code flow with PKCE.

The platform also provides:

- JWT-based access and refresh tokens,
- scoped API keys with per-tenant rate limiting and usage metering,
- optional Base Sepolia blockchain anchoring for decentralized identity,
- a developer console for API key management and usage monitoring.

## How It Works

1. **Sign up** at `https://api.zeroauth.dev/api/console/signup` and get your API key.
2. **Authenticate requests** with `Authorization: Bearer za_live_YOUR_KEY`.
3. **Call v1 endpoints** — register identities, verify ZK proofs, initiate SSO flows.
4. **Monitor usage** via the developer console API.

Every API call is metered, rate-limited, and scoped to your tenant account. See [Plans](getting-started/quickstart.md#plans) for limits.

## Start Here

- [Quickstart](getting-started/quickstart.md) — Create an account and make your first API call
- [API Keys](getting-started/api-keys.md) — Managing keys, scopes, and environments
- [API Reference](reference/api-reference.md) — Full endpoint documentation
- [Architecture](concepts/architecture.md) — How ZeroAuth works under the hood
- [Privacy and Security](concepts/privacy-and-security.md) — The zero-storage privacy model

## Documentation Map

### Getting Started

- Account creation and first API call
- API key management and scopes
- Integration configuration

### Concepts

- System architecture
- Privacy model and cryptographic controls
- Platform capabilities and roadmap

### Integrations

- ZKP biometric authentication
- SAML SSO
- OAuth 2.0 / OIDC

### Operations

- Platform status and health
- Developer console and usage monitoring

### Reference

- API endpoints
- Contracts and circuit details
- Error codes

## Related Assets

- [Contracts and circuit reference](reference/contracts-and-circuit.md)
- [Privacy and Security](concepts/privacy-and-security.md)
