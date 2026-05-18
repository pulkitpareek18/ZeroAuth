# @zeroauth/iot — fingerprint terminal driver

Reference firmware skeleton for the ZeroAuth IoT terminal. Talks the R307 /
FPM10A / ZFM-20 family ("ZhiAn protocol") over a serial UART and uploads the
opaque **characteristic bytes** to the host so they can be hashed locally —
the raw fingerprint image never leaves this process.

This is the first piece of B03 from the 8-week build plan. Eventually moves
into its own repo `zeroauth-dev/ZeroAuth-IoT` once the protocol is stable;
for now it lives in-tree so we can iterate.

## What's in scope

- R307 family driver (TypeScript, Node 20+)
- Five CLI commands — `info`, `enroll`, `search`, `capture`, `wipe`
- SHA-256 placeholder commitment for the captured characteristic

## What's NOT in scope yet

- The Pramaan fuzzy extractor + Poseidon commitment (lives in `/circuits`)
- POST to `/v1/users/register` / `/v1/verifications` (next pass, once a
  fuzzy-extractor binding is wired)
- Hardware attestation, secure element key sealing, network resilience
- The GT-521 protocol or any of the non-ZhiAn families

## Hardware setup

| Sensor pin | UART adapter pin |
|---|---|
| VCC (red) | 3.3 V or 5 V — check the datasheet for your board variant. The R307 itself runs 4.2–6 V; many UART adapters expose 3.3 V which is borderline. If the LED never lights, swap to 5 V. |
| GND (black) | GND |
| TX (yellow) | RX |
| RX (white) | TX |

On macOS the adapter shows up as `/dev/cu.usbserial-XXXX`. On Linux it's
`/dev/ttyUSB0` (CH340) or `/dev/ttyUSB1` (FT232 / CP2102). Set `ZA_IOT_PORT`
if yours isn't `/dev/cu.usbserial-0001`.

## Fingerprint demo web app

A minimal HTML+TS demo that uses the sensor as the login password.

```bash
npm --prefix iot run demo
# → http://localhost:3100
```

The bridge serves a static page (`iot/demo/index.html`) and exposes:

| Method | Path | Body | Behaviour |
|---|---|---|---|
| POST | `/api/demo/signup` | `{ email }` | Two-capture enrollment, binds the email to the chosen slot |
| POST | `/api/demo/login` | `{ email }` | Single scan, 1:N match, checks the matched slot is the one bound to that email |
| GET | `/api/demo/accounts` | — | Lists all in-memory bindings |
| POST | `/api/demo/reset` | — | Wipes the sensor library + clears the binding map |

Bindings are mirrored to `iot/data/demo-accounts.json` so the demo survives
restarts. The R307's own template store is already persistent.

**Demo guard rails (not production code):**

- Bridge binds 127.0.0.1 only.
- No auth on the endpoints — any local process can list accounts or reset.
- Matching uses the sensor's internal algorithm (slot-index lookup), NOT
  the Pramaan fuzzy extractor + Groth16 pipeline. The slot index leaves
  the sensor in cleartext.

## Install + run

```bash
# From the repo root:
npm --prefix iot install

# Probe the connection:
npm --prefix iot run info

# Two-capture enrollment at slot 0:
npm --prefix iot run enroll -- 0

# 1:N match against the on-sensor library:
npm --prefix iot run search

# Single capture → upload characteristic → SHA-256:
npm --prefix iot run capture

# Wipe the entire template library (interactive confirm):
npm --prefix iot run wipe
```

The `info` command does not touch the sensor's flash and is safe to run
any time. `enroll` and `wipe` mutate persistent state.

## Environment overrides

| Variable | Default | Note |
|---|---|---|
| `ZA_IOT_PORT` | `/dev/cu.usbserial-0001` | Serial path |
| `ZA_IOT_BAUD` | `57600` | R307 default; some clones ship at 9600 |
| `ZA_IOT_PASSWORD` | `00000000` | 4-byte hex; sensors that were locked at the factory use a non-zero password |

## Protocol summary (reference)

Each frame on the wire is:

```
header (0xEF 0x01) | address (4B) | PID (1B) | length (2B) | payload | checksum (2B)
```

The driver in [`src/sensor.ts`](src/sensor.ts) implements the subset of the
ZhiAn command set needed for the five CLI verbs. See the inline
constants — `CMD`, `CONF`, `PID` — for the byte values and the per-command
ack semantics.

## Security notes

- The fingerprint **image** stays inside the sensor IC. We only ever read
  the **characteristic** (an opaque template — 256–512 bytes). That
  characteristic still derives from the underlying biometric; treat it as
  sensitive in memory and never persist it outside this process. The
  `capture` CLI deliberately discards it after hashing.
- The on-sensor template store remains a soft secret: anyone with physical
  access to the sensor can run `wipe` and erase the user enrolment. The
  production terminal locks this behind a tamper-evident enclosure.
- The default password is 0x00000000. Production deploys should rotate it
  via the `SetPassword` command before the device leaves the factory.
- Per the ZeroAuth threat model A-V01, this driver and the eventual
  firmware live in a separate trust domain from the central API. The
  network surface here is "outbound only" — no listening sockets.
