# Demo runbook — IoT terminal → central API → dashboard

The fixed demo script for Week 2 of the 7-week plan ([central-api-delivery-plan.md](central-api-delivery-plan.md)).
Anyone on the team should be able to run this end-to-end without
hardware in under five minutes.

## Outcome the operator is showing

> "A fingerprint terminal in the field hands off a verified check-in to
> our hosted API in real time. The dashboard reflects it instantly. No
> biometric data ever crosses the wire."

## Pre-flight (one-time)

1. **Tenant + API key.** Sign up at <https://console.zeroauth.dev/signup>
   and mint a tenant API key with scopes `devices:write`, `users:write`,
   `verifications:write`, `attendance:write`. Copy the `za_test_…`
   string — you'll only see it once.

2. **Bridge env.** In the terminal you'll run the bridge from:

   ```bash
   export ZA_CENTRAL_API_URL=https://api.zeroauth.dev
   export ZA_CENTRAL_API_KEY=za_test_…
   export ZA_CENTRAL_DEVICE_ID=demo-lobby-1
   export ZA_CENTRAL_DEVICE_NAME='Lobby demo (sim)'
   export ZA_SIM_MODE=1                 # omit if the R307 is attached
   ```

3. **Two browser tabs already open**, side by side:
   - <https://console.zeroauth.dev/overview> (logged in as the demo tenant)
   - The bridge's local page, opens to <http://localhost:3100> after step 1 below

## Demo (≈ 4 min)

### Step 1 — boot the bridge

```bash
npm --prefix iot run demo
```

Operator script: "This is the firmware that runs on the IoT terminal —
a R307 fingerprint sensor over UART. I'm running it in sim mode right
now because we're not on the lobby hardware, but the same code ships to
the device."

Look for these log lines (proves the central API is wired):

```
[bridge] central-api: enabled, base=https://api.zeroauth.dev, device=demo-lobby-1
[central-api] device created id=dev_… (or 'resolved' on a repeat run)
[bridge] demo running at http://127.0.0.1:3100
```

### Step 2 — enroll a user (signup)

In the bridge page:
- Type a demo email (any address — the OTP is shown inline because
  `DEV_SHOW_OTP` is on by default).
- Confirm the code.
- Watch the phase pills tick through `awaiting_finger` → `captured` →
  `deriving` → `proving` → `verifying` → `syncing_central` →
  `central_synced`.

Operator script: "The fingerprint is captured locally and turned into a
Poseidon commitment on the device. Only the commitment leaves — never
the image."

Flip to the dashboard tab: **Overview** now shows `users: 1` and the
new email under "Recent users".

### Step 3 — verify + check-in (login)

In the bridge page, click **Sign in** with the same email. Phase pills
tick through `awaiting_finger` → `matching` → `proving` → `verifying`
→ `syncing_central` (verification) → `syncing_central` (attendance) →
`central_synced`.

Operator script: "The terminal proves the same finger without revealing
it — a zero-knowledge proof of biometric possession. The hosted API
records the verification event and the check-in."

Flip to the dashboard tab:
- **Overview**: `verifications: 1`, `attendanceEvents: 1`
- **Verifications**: a row with `method: fingerprint`, `result: pass`,
  the confidence score from the sensor
- **Attendance**: a row with `event_type: check_in`, `result: accepted`,
  joined to the user from step 2 and the device from step 1

### Step 4 — close

Operator script: "Three independent surfaces — the terminal, the API,
the dashboard. The biometric stayed on the device. The breach surface
is the commitment, which is information-theoretically useless without
the finger."

## Failure recovery

| Symptom                                | Fix                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| `[central-api] device resolution failed` | `ZA_CENTRAL_API_KEY` wrong or missing the four required scopes                       |
| `central_skipped reason=remote_error`  | Live network blip — re-run the same step; the bridge keeps the local result either way |
| Bridge page hangs at `awaiting_finger` | `ZA_SIM_MODE` not set and no R307 attached — set the env and restart                 |
| Dashboard rows don't appear            | Confirm the dashboard is on the same tenant as the API key; environment is `test`    |

## What this proves

- W2 charter: "device firmware calls `/v1/verifications` + `/v1/attendance`" ✅
- W2 charter: "dashboard/overview confirms check-in and check-out visibility" ✅
- W2 charter: "one fixed demo script using one test tenant" ✅

A "live tenant" variation just swaps `ZA_CENTRAL_API_KEY` for a
`za_live_…` key; everything else is identical.
