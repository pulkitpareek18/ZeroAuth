# SAML SSO

ZeroAuth provides SAML 2.0 endpoints that sit between enterprise identity providers and your application. Use ZeroAuth as a SAML Service Provider (SP) to authenticate users via their corporate IdP.

## How It Works

1. Your application calls `GET /v1/auth/saml/login` with your API key.
2. ZeroAuth returns the IdP redirect URL.
3. Redirect the user's browser to the IdP.
4. The user authenticates with their corporate identity provider.
5. The IdP posts a SAML assertion back to ZeroAuth's callback endpoint.
6. ZeroAuth validates the assertion and issues JWT session tokens.

## API Endpoints

All SAML endpoints require an API key with the appropriate scope.

### Login Initiation

**Required scope:** `saml:login`

```bash
curl https://api.zeroauth.dev/v1/auth/saml/login \
  -H "Authorization: Bearer za_live_YOUR_KEY"
```

Example response:

```json
{
  "redirectUrl": "https://idp.example.com/sso/saml",
  "issuer": "zeroauth-sp",
  "message": "SAML SSO login endpoint"
}
```

Redirect the user's browser to `redirectUrl` to initiate the SSO flow.

### Callback Handling

**Required scope:** `saml:callback`

```bash
curl -X POST https://api.zeroauth.dev/v1/auth/saml/callback \
  -H "Authorization: Bearer za_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "SAMLResponse": "<base64-encoded-saml-response>",
    "nameID": "user@corp.com",
    "email": "user@corp.com"
  }'
```

Success response:

```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<jwt>",
  "tokenType": "Bearer",
  "expiresIn": 3600,
  "sessionId": "4fce1f26-72d7-4d91-8fd2-4a2d66dc2b93",
  "provider": "saml",
  "dataStorageConfirmation": {
    "biometricDataStored": false,
    "message": "Zero biometric data stored. Ever."
  }
}
```

### SP Metadata

**Required scope:** `saml:login`

```bash
curl https://api.zeroauth.dev/v1/auth/saml/metadata \
  -H "Authorization: Bearer za_live_YOUR_KEY"
```

Returns SP metadata XML for configuring your IdP. Includes the SP `entityID`, Assertion Consumer Service callback URL, and signing preferences.

## Required API Key Scopes

Your API key needs these scopes for SAML integration:

| Scope | Purpose |
|---|---|
| `saml:login` | Initiate SSO flows and fetch SP metadata |
| `saml:callback` | Process SAML assertions from IdPs |

Create a key with SAML scopes:

```bash
curl -X POST https://api.zeroauth.dev/api/console/keys \
  -H "Authorization: Bearer YOUR_CONSOLE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "SAML Integration",
    "scopes": ["saml:login", "saml:callback", "identity:read"]
  }'
```

## Integration Guide

1. **Get SP metadata** from `/v1/auth/saml/metadata` and configure your IdP.
2. **Create an API key** with `saml:login` and `saml:callback` scopes.
3. **Initiate login** by calling `/v1/auth/saml/login` and redirecting the user.
4. **Handle the callback** by forwarding the SAML assertion to `/v1/auth/saml/callback`.
5. **Use the session tokens** returned by ZeroAuth to authenticate the user in your app.

For endpoint-level details, see [API Reference](../reference/api-reference.md).
