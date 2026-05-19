# ADR-0007: Adopt `serialport` (v12) as the UART transport for the IoT terminal

- **Status:** Accepted
- **Date:** 2026-05-18
- **Owner:** Pulkit Pareek
- **Supersedes:** —

## Context

B03 (the ZeroAuth IoT terminal) needs to talk to a fingerprint sensor over
a USB-UART adapter. The first device under test is an R307 / FPM10A / ZFM-20
module on `/dev/cu.usbserial-0001` (Mac dev box) or `/dev/ttyUSB0` (Orange
Pi production target). Both run Node 20.

The transport choice has to:

1. Open a `/dev/cu.*` or `/dev/ttyUSB*` file descriptor with arbitrary baud.
2. Stream-read incoming frames into a buffer so the driver can re-parse on
   each chunk arrival (R307 frames are 11+ bytes, can arrive split).
3. Drain reliably so the host doesn't lose ACKs after a fast command burst.

## Options considered

### A — `serialport` (npm) v12 (chosen)

- The canonical Node serial library. ~6.8M monthly downloads, 7-year
  maintenance history, polyfilled across darwin / linux / win32.
- Native module (uses node-gyp). Adds ~30 s to `npm install` on a cold
  box because it builds against the local Node ABI; prebuilds are
  published for darwin-arm64 / darwin-x64 / linux-x64 / linux-armv7l
  which covers every host in our deploy matrix (Mac dev + Orange Pi).
- TypeScript types included.
- Reliable `drain()` semantics — important because the R307 ACKs come
  ~50 ms after a command and node's default write buffering will
  reorder them if we don't drain.

### B — write a /dev/cu.* shim with `fs.open` + `O_NONBLOCK`

- Zero dependencies, but we'd have to reimplement termios on each OS,
  poll-loop the descriptor, and re-derive baud divisors. ~400 lines of
  delicate per-OS code we'd then own forever.

### C — `node-serialport` v9 (pinned older)

- Older API surface; doesn't have a typed `port.drain()` callback and
  has a known issue on Apple Silicon when the adapter is hot-plugged.

### D — Out-of-process bridge (e.g. `socat` to a TCP socket, Node connects via net)

- Adds a moving part. Useful for debugging (saves a tcpdump-like
  capture of the UART traffic), but routine use is heavier than the
  problem warrants.

## Decision

Adopt **`serialport` v12** as a direct dependency of the new `iot/`
workspace. Pin via `^12.0.0` so we pick up minor versions automatically;
breaking changes go through this ADR's revision process.

Rationale ranked:

1. **Cost of writing the alternative outweighs the dep cost.** Option B
   is genuinely a wheel-reinvention; the per-OS termios surface is well
   below the value bar of an in-house implementation.
2. **Native-build pain is bounded.** Prebuilt binaries exist for all our
   target platforms. The build only falls back to node-gyp on exotic
   platforms (e.g. armv6l on a Pi Zero) which we don't ship to.
3. **Surface area is small.** We use exactly two `serialport` features
   — `port.on('data')` and `port.drain()` — so a future migration is
   ~100 lines of shim work if needed.

## Consequences

- The `iot/` workspace adds one direct dep + the usual native-build
  preinstall lifecycle. The root `package-lock.json` is not touched
  because `iot/` is a standalone npm project today (separate `package.json`,
  separate `node_modules`).
- `npm --prefix iot install` is the operator's entry point; CI doesn't
  invoke the iot subproject yet (the firmware lives outside CI's reach
  until B03 graduates into its own repo). When we wire CI, the runner
  will need either `apt-get install -y libudev-dev` (linux) or a
  prebuilt binary (darwin) — both are no-cost.
- `scripts/check-dep-trail.sh` does not currently scan `iot/`; we'll
  extend it the next time the iot workspace promotes out of in-tree.
- Supply-chain check: `npm audit` on `iot/` shows zero advisories at
  ADR-write time. The `serialport` author has been continuously
  maintaining the package since 2018.

## Follow-ups

- When the IoT terminal moves to `zeroauth-dev/ZeroAuth-IoT`, this ADR
  travels with it.
- Add `serialport` to the dep-trail allow-list once `iot/` is part of
  the scan boundary.

---

LAST_UPDATED: 2026-05-18
