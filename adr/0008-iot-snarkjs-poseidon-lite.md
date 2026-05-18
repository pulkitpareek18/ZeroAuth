# ADR-0008: Adopt `snarkjs` + `poseidon-lite` for the IoT fingerprint demo

- **Status:** Accepted
- **Date:** 2026-05-18
- **Owner:** Pulkit Pareek
- **Supersedes:** —

## Context

The fingerprint demo at `iot/src/bridge.ts` started life as a slot-binding
toy — the host stored `{email: slot}` and the sensor's 1:N match was the
whole story. The user asked for the demo to "use our ZKP-based tech to
calculate." Concretely: the bridge should compute the same Patent-Claim-3
commitment construction the main API uses (`src/services/identity.ts`)
and generate + verify a Groth16 proof per login.

Two primitives are needed on the IoT side:

1. **Poseidon hash** for the commitment derivation.
2. **Groth16 prover + verifier** for the identity_proof circuit.

The circuit and its build artifacts (`identity_proof.wasm`,
`circuit_final.zkey`, `verification_key.json`) already exist under
`circuits/build/`. What's missing on the iot/ side is the host-language
tooling to feed witness inputs to that circuit and verify the resulting
proof.

## Options considered

### A — `snarkjs` (v0.7.x) + `poseidon-lite` (v0.3.x)  (chosen)

- `snarkjs` is the reference Groth16 implementation the main API
  already uses (see `src/services/zkp.ts` and the verifier workspace).
  Same Node version, same proving artefacts; cross-process compatibility
  is free.
- `poseidon-lite` is a hand-tuned Poseidon for BN128 with a tiny
  install size (~200 KB), pure JS, no native compilation. It matches
  the round constants from circomlib so commitments interoperate with
  the existing circuit and the main API's `identity.ts`.
- Both are pure JS. No node-gyp build. Installs in <10 s on a cold box.

### B — `circomlibjs` (v0.1.x)

- What the main API uses today via `circomlibjs.buildPoseidon()`.
- ~2.5 MB install vs `poseidon-lite`'s 200 KB. Brings in `ffjavascript`,
  `blake-hash`, and a few other heavyweight modules.
- API requires an async `build` step at startup. `poseidon-lite` is
  synchronous, which simplifies the bridge's init order.
- Identical hash output. Choosing the lighter one because the IoT
  surface is bandwidth- and footprint-sensitive even on a dev laptop.

### C — Roll our own Poseidon

- Five-hundred-line constant table + 8 full + 57 partial rounds of
  field arithmetic per call. The constants need to match circomlib
  exactly or commitments diverge from the main API's. Auditing two
  independent Poseidon implementations against each other is the
  exact wheel-reinvention this ADR exists to prevent.

### D — Skip the proof on the IoT side; have the host send (commitment, signals) to the central API which generates the proof there

- Requires the IoT terminal to leak the witness over the network to a
  trusted proving service. That defeats the whole "device proves to
  server" shape of the ZeroAuth model — even for a demo it's worse
  ergonomics than running snarkjs locally.

## Decision

Take **`snarkjs ^0.7.4` + `poseidon-lite ^0.3.0`** as direct deps of
the `iot/` workspace.

Justification ranked:

1. **Same primitives, same field, same artefacts** as the main API.
   Commitments minted on the iot side could be round-trip verified by
   the central /v1 surface tomorrow without any code change in either.
2. **Pure-JS, fast install.** The iot workspace already has the
   native-build cost of `serialport`; piling another native module on
   top would noticeably slow `npm --prefix iot install`. `snarkjs` and
   `poseidon-lite` are zero-build wheels.
3. **`poseidon-lite` over `circomlibjs`** trades ~2.3 MB of dependency
   surface for sync-init code. The hash output is bit-identical because
   both pull the same circomlib round constants — that's the whole
   point of poseidon-lite.

## Consequences

- `iot/package.json` gains two direct deps.
- `iot/src/proof.ts` reads `circuits/build/{identity_proof.wasm,
  circuit_final.zkey, verification_key.json}` at startup. The iot
  workspace now depends on the existence of those artefacts; if the
  circuit is rebuilt with different constants, the iot proof step
  starts producing proofs that the main API can't verify (and vice
  versa). Mitigation: the build pipeline ships the artefacts together;
  rebuilds are explicit operations gated by ADRs.
- `npm audit` shows three "high" advisories in `snarkjs`'s transitive
  deps (`got` / `keccak` / older `ws`). They're well-known, don't
  affect Groth16 correctness, and don't reach the bridge's surface.
  We mirror the same exposure the main API already takes.
- Adds ~12 MB to `iot/node_modules`. Tolerable for a host-side bridge;
  the production firmware on Orange Pi will swap snarkjs for a smaller
  proving stack (rapidsnark or arkworks). Out of scope for this ADR.

## Follow-ups

- When `iot/` graduates into `zeroauth-dev/ZeroAuth-IoT`, this ADR
  travels with it and `scripts/check-dep-trail.sh` extends to scan the
  new repo.
- The Orange Pi firmware path will revisit Option D in reverse —
  consider sending the proof generation back to a trusted enclave on
  the device rather than running snarkjs on a constrained CPU.

---

LAST_UPDATED: 2026-05-18
