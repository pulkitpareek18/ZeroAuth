# Environment Variables

This page documents the environment variables used by the ZeroAuth platform. These are internal configuration variables — as an API consumer, you only need an API key to get started.

:::info
If you are integrating with ZeroAuth's hosted API, you do not need to configure any of these variables. Just use your API key with `https://zeroauth.dev`. This page is provided for transparency and for contributors to the ZeroAuth platform.
:::

## Server and Runtime

| Variable | Default | Required | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | No | When set to `production`, missing required secrets throw at startup. |
| `PORT` | `3000` | No | API listen port. |
| `API_BASE_URL` | `http://localhost:3000` | No | Used in service metadata, OIDC discovery, and SAML callbacks. Production: `https://zeroauth.dev` |

## JWT

| Variable | Default | Required | Notes |
| --- | --- | --- | --- |
| `JWT_SECRET` | `dev-secret-change-me` | Yes in production | Signing key for access and refresh tokens. |
| `JWT_EXPIRES_IN` | `1h` | No | Supports `s`, `m`, `h`, `d` units. |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | No | Supports `s`, `m`, `h`, `d` units. |

## SAML

| Variable | Default | Required | Notes |
| --- | --- | --- | --- |
| `SAML_ENTRY_POINT` | `https://idp.example.com/sso/saml` | No | IdP SSO endpoint returned by `/v1/auth/saml/login`. |
| `SAML_ISSUER` | `zeroauth-sp` | No | SP entity ID used in login response and metadata XML. |
| `SAML_CALLBACK_URL` | `https://api.zeroauth.dev/v1/auth/saml/callback` | No | Assertion Consumer Service URL in metadata XML. |
| `SAML_CERT` | empty | No | IdP certificate for assertion validation. |

## OIDC

| Variable | Default | Required | Notes |
| --- | --- | --- | --- |
| `OIDC_ISSUER` | `https://accounts.google.com` | No | Used to build the authorize URL. |
| `OIDC_CLIENT_ID` | empty | No | Included in the authorize URL. |
| `OIDC_CLIENT_SECRET` | empty | No | Used for token exchange. |
| `OIDC_REDIRECT_URI` | `https://api.zeroauth.dev/v1/auth/oidc/callback` | No | Included in the authorize URL. |

## Session and Admin

| Variable | Default | Required | Notes |
| --- | --- | --- | --- |
| `SESSION_SECRET` | `dev-session-secret` | Yes in production | Session-related runtime security. |
| `ADMIN_API_KEY` | `dev-admin-key` | Yes in production | Required for `/api/admin/*` internal routes. |

## Database

| Variable | Default | Required | Notes |
| --- | --- | --- | --- |
| `POSTGRES_HOST` | `localhost` | No | PostgreSQL hostname. |
| `POSTGRES_PORT` | `5432` | No | PostgreSQL port. |
| `POSTGRES_DB` | `zeroauth` | No | Database name. |
| `POSTGRES_USER` | `zeroauth` | No | Database user. |
| `POSTGRES_PASSWORD` | `zeroauth-dev` | Yes in production | Database password. |

## Rate Limiting and Logging

| Variable | Default | Required | Notes |
| --- | --- | --- | --- |
| `RATE_LIMIT_WINDOW_MS` | `900000` | No | 15-minute default window (global rate limiter). |
| `RATE_LIMIT_MAX_REQUESTS` | `300` | No | Max requests per window (global). Per-tenant limits are plan-based. |
| `LOG_LEVEL` | `info` | No | Winston log level. |

## Blockchain

| Variable | Default | Required | Notes |
| --- | --- | --- | --- |
| `BLOCKCHAIN_RPC_URL` | `https://sepolia.base.org` | No | Base Sepolia RPC endpoint. |
| `BLOCKCHAIN_CHAIN_ID` | `84532` | No | Base Sepolia chain ID. |
| `BLOCKCHAIN_PRIVATE_KEY` | empty | Needed for blockchain features | If missing, blockchain initialization is skipped. |
| `DID_REGISTRY_ADDRESS` | empty | Needed for live DID writes | Enables the DID registry contract client. |
| `VERIFIER_CONTRACT_ADDRESS` | empty | Needed for on-chain proof verification | Enables the verifier contract client. |
| `VERIFY_ON_CHAIN` | `false` | No | Adds optional contract verification after off-chain verification. |

## ZKP Artifacts

| Variable | Default | Required | Notes |
| --- | --- | --- | --- |
| `ZKP_WASM_PATH` | `circuits/build/identity_proof_js/identity_proof.wasm` | No | Returned by `/v1/auth/zkp/circuit-info`. |
| `ZKP_ZKEY_PATH` | `circuits/build/circuit_final.zkey` | No | Proving key path. |
| `ZKP_VKEY_PATH` | `circuits/build/verification_key.json` | No | Loaded at startup for off-chain proof verification. |

## Redis

| Variable | Default | Required | Notes |
| --- | --- | --- | --- |
| `REDIS_URL` | `redis://localhost:6379` | No | Redis connection URL. |
| `USE_REDIS_SESSIONS` | `false` | No | Enable Redis-backed session storage. |
