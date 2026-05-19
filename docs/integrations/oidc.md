# OAuth 2.0 / OIDC

ZeroAuth provides OAuth 2.0 / OpenID Connect endpoints using the authorization code flow with PKCE. Use ZeroAuth to authenticate users via external identity providers like Google, Microsoft, Okta, or any OIDC-compliant provider.

## How It Works

1. Your application calls `GET /v1/auth/oidc/authorize` with your API key.
2. ZeroAuth generates PKCE parameters and returns the authorization URL.
3. Redirect the user's browser to the authorization URL.
4. The user authenticates with the identity provider.
5. The provider redirects back with an authorization code.
6. Your application posts the code and state to `POST /v1/auth/oidc/callback`.
7. ZeroAuth exchanges the code, validates the ID token, and issues session tokens.

## API Endpoints

All OIDC endpoints require an API key with the appropriate scope.

### Authorization Start

**Required scope:** `oidc:authorize`

```bash
curl https://api.zeroauth.dev/v1/auth/oidc/authorize \
  -H "Authorization: Bearer za_live_YOUR_KEY"
```

Response:

```json
{
  "authorizeUrl": "https://accounts.google.com/authorize?response_type=code&client_id=...&scope=openid+email+profile&state=...&code_challenge=...&code_challenge_method=S256&nonce=...",
  "state": "2e6d1280-f8bb-4b0f-a0b0-f48665fce5da"
}
```

Redirect the user's browser to `authorizeUrl`. ZeroAuth handles PKCE challenge generation automatically.

### Callback Handling

**Required scope:** `oidc:callback`

```bash
curl -X POST https://api.zeroauth.dev/v1/auth/oidc/callback \
  -H "Authorization: Bearer za_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "authorization-code-from-provider",
    "state": "<state-from-authorize>"
  }'
```

Success response:

```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<jwt>",
  "tokenType": "Bearer",
  "expiresIn": 3600,
  "sessionId": "9a0710b2-c0cb-4c96-bf53-d59cb6a9d0e1",
  "provider": "oidc",
  "dataStorageConfirmation": {
    "biometricDataStored": false,
    "message": "Zero biometric data stored. Ever."
  }
}
```

Validation enforced:

- `code` must be present
- `state` must be present and match a pending authorization request
- State values expire after 10 minutes

## Required API Key Scopes

| Scope | Purpose |
|---|---|
| `oidc:authorize` | Initiate OIDC authorization flows |
| `oidc:callback` | Process authorization callbacks |

Create a key with OIDC scopes:

```bash
curl -X POST https://api.zeroauth.dev/api/console/keys \
  -H "Authorization: Bearer YOUR_CONSOLE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "OIDC Integration",
    "scopes": ["oidc:authorize", "oidc:callback", "identity:read"]
  }'
```

## Integration Guide

1. **Create an API key** with `oidc:authorize` and `oidc:callback` scopes.
2. **Start the flow** by calling `/v1/auth/oidc/authorize` — save the returned `state`.
3. **Redirect the user** to `authorizeUrl`.
4. **Handle the redirect** — when the provider redirects back, extract `code` and `state` from the URL parameters.
5. **Complete authentication** by posting `code` and `state` to `/v1/auth/oidc/callback`.
6. **Use the session tokens** to authenticate the user in your application.

## Security Features

- **PKCE (S256)** — ZeroAuth generates code verifier and challenge pairs automatically, preventing authorization code interception attacks.
- **State validation** — Each authorization flow uses a unique state token that must match on callback.
- **Automatic cleanup** — Stale authorization states are removed after 10 minutes.

For endpoint-level details, see [API Reference](../reference/api-reference.md).
