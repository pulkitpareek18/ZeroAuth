<div align="center">

  <a href="https://zeroauth.dev">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="public/zeroauth-mark-dark.svg">
      <img src="public/zeroauth-mark.svg" width="96" alt="ZeroAuth" />
    </picture>
  </a>

  <h1>ZeroAuth</h1>

  <p><strong>Enterprise authentication where a breach exposes <em>nothing</em>.</strong></p>

  <p>
    Zero-knowledge biometric verification, SAML 2.0, OAuth 2.0 / OIDC, and
    blockchain-anchored decentralized identity — in a single hosted API.
    No biometric data stored. Ever. Breach-proof by architecture.
  </p>

  <p>
    <a href="https://zeroauth.dev"><strong>zeroauth.dev</strong></a> ·
    <a href="https://docs.zeroauth.dev/">Documentation</a> ·
    <a href="https://docs.zeroauth.dev/getting-started/quickstart">Quickstart</a> ·
    <a href="https://docs.zeroauth.dev/reference/api-reference">API Reference</a>
  </p>

  <p>
    <a href="https://github.com/zeroauth-dev/ZeroAuth/blob/main/LICENSE"><img src="https://img.shields.io/github/license/zeroauth-dev/ZeroAuth?color=blue" alt="License" /></a>
    <a href="https://github.com/zeroauth-dev/ZeroAuth/stargazers"><img src="https://img.shields.io/github/stars/zeroauth-dev/ZeroAuth?style=flat" alt="Stars" /></a>
    <a href="https://github.com/zeroauth-dev/ZeroAuth/issues"><img src="https://img.shields.io/github/issues/zeroauth-dev/ZeroAuth" alt="Issues" /></a>
    <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node 20+" />
    <img src="https://img.shields.io/badge/typescript-strict-blue" alt="TypeScript strict" />
    <img src="https://img.shields.io/badge/zk-Groth16-purple" alt="Groth16" />
    <img src="https://img.shields.io/badge/L2-Base%20Sepolia-0052ff" alt="Base Sepolia" />
  </p>

</div>

---

## What is ZeroAuth?

ZeroAuth is an open-source identity platform that replaces stored credentials
with **zero-knowledge proofs**. Users prove they are who they claim to be
without ever transmitting or storing the underlying biometric template,
password, or shared secret. There is nothing in the database for an attacker
to steal.

A single REST API supports three production authentication paths:

| Path | What it does |
|---|---|
| **ZKP biometric** | Client generates a Groth16 proof of biometric possession; the server verifies it without seeing the biometric. |
| **SAML 2.0** | Standards-compliant SP for enterprise SSO with any IdP (Okta, Azure AD, Ping). |
| **OAuth 2.0 / OIDC** | Authorization-code + PKCE flow with discovery, JWKS, and userinfo. |

Identity registration is anchored on **Base Sepolia L2** via the
`DIDRegistry` contract, so the mapping between a biometric hash and a DID is
publicly auditable and tamper-resistant.

> Built on peer-reviewed primitives — Groth16, Poseidon, BN128, SHA-256.
> Patent-aligned (Indian Patent 202311041001) but the implementation is MIT-licensed.

---

## Why ZeroAuth?

Traditional auth: leak the database, leak everyone's credentials.
ZeroAuth: leak the database, you get… hashes you cannot reverse and proofs that
already expired.

- **Zero biometric data persistence.** Every endpoint returns
  `dataStored: false` as a runtime invariant; the test suite enforces it.
- **Mathematically grounded.** Soundness reduces to discrete-log on BN128;
  zero-knowledge holds in the random-oracle model.
- **Drop-in replacement.** SAML and OIDC endpoints behave like any other SP /
  RP — point your existing IdP at ZeroAuth without changing client code.
- **Multi-tenant from day one.** Scoped API keys (`za_live_…`, `za_test_…`),
  per-tenant rate limits, monthly quotas, usage metering — everything you need
  to run it as a hosted service.
- **Production deployment included.** Docker Compose stack with Caddy
  (auto-TLS via Let's Encrypt), PostgreSQL, Redis, and the app behind a
  reverse proxy.

---

## Architecture

```
       Client (browser / app)                    ZeroAuth API
+-----------------------------+    +--------------------------------------+
| 1. Capture biometric        |    |                                      |
| 2. Generate Groth16 proof   |--->| Tenant + API-key authentication      |
|    (biometric never leaves) |    | Rate limit / quota check             |
+-----------------------------+    |                                      |
                                   | ZKP module — verifyProof()           |       Base Sepolia L2
                                   | SAML module — assertion validation   |    +------------------+
                                   | OIDC module — code exchange + JWKS   |--->| DIDRegistry.sol  |
                                   |                                      |    | Groth16Verifier  |
                                   | JWT issuance + Redis-backed sessions |    +------------------+
                                   |                                      |
                                   | Postgres: tenants, api_keys, usage   |
                                   +--------------------------------------+
```

A deeper walkthrough lives in [docs/concepts/architecture.md](docs/concepts/architecture.md).

---

## Quick start

### Use the hosted API

```bash
# 1. Sign up
curl -X POST https://api.zeroauth.dev/api/console/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"a-strong-password","companyName":"Acme"}'
# → returns { token, apiKey: { key: "za_live_..." } }

# 2. Make your first call
curl https://api.zeroauth.dev/v1/auth/zkp/nonce \
  -H "Authorization: Bearer za_live_YOUR_KEY"
```

Full API reference at [docs.zeroauth.dev/reference/api-reference](https://docs.zeroauth.dev/reference/api-reference).

### Run it yourself (Docker, ~2 minutes)

```bash
git clone https://github.com/zeroauth-dev/ZeroAuth.git
cd ZeroAuth
cp .env.example .env       # generates fresh secrets via scripts/deploy.sh
./scripts/deploy.sh dev
# open http://localhost:3000
```

### Local development without Docker

```bash
npm run setup     # installs all workspaces + builds everything
npm start         # starts the API on http://localhost:3000
npm test          # runs the 45-test jest suite
```

---

## API surface

```
POST  /v1/auth/zkp/register        Register a biometric → DID, anchor on-chain
POST  /v1/auth/zkp/verify          Verify a Groth16 proof, issue session JWT
GET   /v1/auth/zkp/nonce           Fresh nonce for replay protection
GET   /v1/auth/zkp/circuit-info    Circuit metadata for client-side snarkjs

GET   /v1/auth/saml/login          Initiate SAML SSO
POST  /v1/auth/saml/callback       SAML assertion callback
GET   /v1/auth/saml/metadata       SP metadata XML

GET   /v1/auth/oidc/authorize      Start OIDC authorization-code flow (PKCE)
POST  /v1/auth/oidc/callback       Token exchange
GET   /api/auth/oidc/.well-known/openid-configuration

GET   /v1/identity/me              Profile from session JWT
POST  /v1/identity/logout          Revoke session

POST  /api/console/signup          Create a developer account
POST  /api/console/login           Authenticate, get a console JWT
GET   /api/console/keys            List API keys
POST  /api/console/keys            Create an API key
DELETE/api/console/keys/:id        Revoke an API key
GET   /api/console/usage           Per-tenant usage + quota

GET   /api/health                  Service + blockchain status
GET   /api/admin/stats             Admin dashboard data (x-api-key)
GET   /api/admin/blockchain        Live contract state (x-api-key)
GET   /api/admin/privacy-audit     Zero-storage audit report (x-api-key)
```

---

## Tech stack

- **Runtime:** Node.js 20, TypeScript 5 (strict), Express 4
- **ZK:** Circom 2 + snarkjs, Groth16, Poseidon, BN128
- **Blockchain:** Solidity 0.8, ethers v6, Hardhat, Base Sepolia L2 (chain 84532)
- **Storage:** PostgreSQL 16, Redis 7, in-memory session fallback
- **Frontend:** React 19 + Vite (admin dashboard), Docusaurus 3 (docs site),
  vanilla TypeScript / HTML (marketing landing)
- **Test:** Jest 29 with 45 deterministic tests (zero-data-storage invariant
  enforced)
- **Ops:** Multi-stage Dockerfile, Docker Compose with Redis + Postgres +
  Caddy reverse proxy + automatic Let's Encrypt TLS, health-checked containers
- **Security:** helmet, CORS allowlist, rate limiting, PKCE, scrypt passwords,
  SHA-256 API key hashing, non-root container, strict CSP

Full dependency map in [package.json](package.json).

---

## Contracts (Base Sepolia)

| Contract | Address |
|---|---|
| `DIDRegistry` | [`0xC68ceB726DDB898E899080021A0B9e7994f63A73`](https://sepolia.basescan.org/address/0xC68ceB726DDB898E899080021A0B9e7994f63A73) |
| `Groth16Verifier` | [`0x58258bf549D8E8694b22B12410F24583D16e1aA4`](https://sepolia.basescan.org/address/0x58258bf549D8E8694b22B12410F24583D16e1aA4) |

Source: [contracts/DIDRegistry.sol](contracts/DIDRegistry.sol),
[contracts/Verifier.sol](contracts/Verifier.sol). Circuit definition:
[circuits/identity_proof.circom](circuits/identity_proof.circom).

---

## Deploying to your own domain

ZeroAuth ships with an opinionated production stack that brings up the API,
database, cache, and reverse-proxied auto-TLS in a single command. Full guide
in the README's *Deploying to zeroauth.dev* section above and in
[docs/operations/deployment.md](docs/operations/deployment.md).

The minimum:

1. A VPS with Docker, Docker Compose, ports 80/443 open.
2. DNS A-records for `yourdomain.tld` pointing at the VPS.
3. `cp .env.production.template .env` and fill in `BLOCKCHAIN_PRIVATE_KEY`.
4. `./scripts/deploy.sh prod`.

Caddy obtains a real Let's Encrypt cert on the first request.

---

## Project structure

```
ZeroAuth/
├── circuits/            Circom circuit + compiled WASM/zkey/vkey
├── contracts/           Solidity sources + Hardhat config
├── src/
│   ├── routes/v1/       Hosted, API-key-authenticated endpoints
│   ├── routes/console/  Developer console (signup, keys, usage)
│   ├── services/        ZKP, blockchain, identity, JWT, DB, sessions
│   └── middleware/      Auth, tenant gates, error handling
├── dashboard/           React admin UI
├── website/             Docusaurus docs site
├── docs/                Markdown source for the docs site
├── tests/               Jest suite (45 tests, zero-storage invariants)
├── scripts/             deploy.sh, setup-zkp.sh, deploy-contracts.ts,
│                        transfer-ownership.ts
├── public/              Marketing landing + favicon
├── Caddyfile            Reverse proxy + TLS for production
└── docker-compose.yml   dev / test / prod profiles with Redis + Postgres
```

---

## Contributing

Issues, PRs, and discussions are welcome. Please read
[CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md)
first.

For security disclosures, see [SECURITY.md](SECURITY.md) — please **do not**
file public issues for vulnerabilities.

---

## License

MIT © Pulkit Pareek and contributors. See [LICENSE](LICENSE).

The underlying decentralized-identity workflow is covered by Indian Patent
**202311041001**; this MIT release grants you a no-cost license for the patent
claims practiced by the source in this repository, for any use.
