# Central API

This is the reusable Week 1 product core described in the 7-week plan. It is the shared backend that the IoT attendance device, insurance claim demo, crypto authorization demo, and hospital identity demo should all call.

Use this layer for:

- developer account creation and API-key management
- tenant-scoped device registration
- user enrollment without storing biometric data
- verification event recording
- attendance check-in and check-out events
- enterprise audit visibility

## Control Plane

These endpoints are for the developer or operator building on ZeroAuth.

### `POST /api/console/signup`

Create a tenant account and receive the first live API key.

```bash
curl -X POST https://api.zeroauth.dev/api/console/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "dev@company.com",
    "password": "super-secure-password",
    "companyName": "Company Inc"
  }'
```

### `POST /api/console/login`

Authenticate and receive a console token.

### `GET /api/console/account`

Return tenant profile, plan, quota, and account status.

### `GET /api/console/keys`

List all API keys for the authenticated tenant.

### `POST /api/console/keys`

Create another API key. Supports `live` or `test` environments and explicit scopes.

### `DELETE /api/console/keys/:keyId`

Revoke an API key permanently.

### `GET /api/console/usage`

Return current-month usage, rate limits, and recent API calls.

### `GET /api/console/overview?environment=live`

Return the Week 1 demo viewer payload:

- counts for devices, users, verifications, attendance events, and audit events
- recent devices
- recent users
- recent verifications
- recent attendance events
- recent audit events

### `GET /api/console/audit?environment=live`

Return recent business audit events for a single environment.

## Product Data Plane

All `/v1/*` routes require a tenant API key.

```bash
-H "Authorization: Bearer za_live_YOUR_KEY"
```

The environment is derived from the key itself:

- `za_live_*` writes and reads `live` records
- `za_test_*` writes and reads `test` records

## Core Scopes

Default keys now include the central API scopes below:

- `devices:read`
- `devices:write`
- `users:read`
- `users:write`
- `verifications:read`
- `verifications:write`
- `attendance:read`
- `attendance:write`
- `audit:read`

## Devices

Devices model real enterprise assets such as the battery-powered attendance device in Week 2.

### `POST /v1/devices`

Register a device.

```bash
curl -X POST https://api.zeroauth.dev/v1/devices \
  -H "Authorization: Bearer za_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Front Desk Attendance Unit",
    "externalId": "iot-blr-hq-01",
    "locationId": "blr-hq",
    "batteryLevel": 94,
    "metadata": {
      "firmware": "0.1.0",
      "connectivity": "wifi"
    }
  }'
```

### `GET /v1/devices`

List devices for the current tenant and environment.

Optional query params:

- `status=active|inactive|retired`
- `limit=1..100`

### `PATCH /v1/devices/:deviceId`

Update device status, battery level, metadata, or last seen timestamp.

## Users

Users are business identities enrolled under a tenant. This layer stores non-biometric reference data only.

### `POST /v1/users`

Create an enrolled user.

```bash
curl -X POST https://api.zeroauth.dev/v1/users \
  -H "Authorization: Bearer za_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Aditi Sharma",
    "externalId": "emp-001",
    "employeeCode": "ZS-001",
    "primaryDeviceId": "DEVICE_UUID",
    "metadata": {
      "department": "Operations"
    }
  }'
```

### `GET /v1/users`

List enrolled users.

Optional query params:

- `status=active|inactive`
- `limit=1..100`

### `PATCH /v1/users/:userId`

Update assigned device, status, or reference metadata.

## Verifications

Verifications are product-level decision records. This is the shared API contract that later demo wrappers should call, regardless of whether the flow is IoT attendance, insurance claim validation, or crypto withdrawal authorization.

### `POST /v1/verifications`

Record a verification outcome.

```bash
curl -X POST https://api.zeroauth.dev/v1/verifications \
  -H "Authorization: Bearer za_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "USER_UUID",
    "deviceId": "DEVICE_UUID",
    "method": "fingerprint",
    "result": "pass",
    "reason": "matched-template",
    "confidenceScore": 98.5,
    "referenceId": "attendance-attempt-1001",
    "metadata": {
      "presenceCheck": "depth-ok"
    }
  }'
```

Supported methods:

- `zkp`
- `fingerprint`
- `face`
- `depth`
- `saml`
- `oidc`
- `manual`

Supported results:

- `pass`
- `fail`
- `challenge`

### `GET /v1/verifications`

List recent verification events.

Optional query params:

- `method=...`
- `result=...`
- `limit=1..100`

## Attendance

Attendance is the Week 2 showcase surface. It should be driven by the same verification records above.

### `POST /v1/attendance`

Record a check-in or check-out event.

```bash
curl -X POST https://api.zeroauth.dev/v1/attendance \
  -H "Authorization: Bearer za_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "USER_UUID",
    "deviceId": "DEVICE_UUID",
    "verificationId": "VERIFICATION_UUID",
    "type": "check_in"
  }'
```

If `verificationId` is supplied and `result` is omitted, ZeroAuth derives:

- `accepted` from a `pass` verification
- `rejected` from a `fail` or `challenge` verification

### `GET /v1/attendance`

List recent attendance events.

Optional query params:

- `type=check_in|check_out`
- `result=accepted|rejected`
- `limit=1..100`

## Audit

Audit is the enterprise evidence layer. Every central-API domain write records an audit event.

### `GET /v1/audit`

List audit events for the current tenant and environment.

Optional query params:

- `action=device.created`
- `status=success|failure`
- `limit=1..100`

Audit events include:

- actor type and actor id
- action
- entity type and entity id
- success or failure
- summary
- timestamp
- metadata

## What This Unlocks

With this central API in place, the next layers can stay thin:

- IoT attendance device: capture signal locally, call `/v1/verifications`, then `/v1/attendance`
- insurance claim wrapper: call `/v1/verifications`, then write claim identity audit metadata
- crypto authorization wrapper: call `/v1/verifications`, then attach reference IDs to the withdrawal flow
- hospital identity wrapper: call `/v1/verifications`, then record visit events

That is the main architectural rule for the next 7 weeks: one backend core, many narrow demo wrappers.
