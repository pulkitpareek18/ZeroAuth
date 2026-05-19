/**
 * Patent-Claim-3 commitment derivation for the demo.
 *
 * Mirrors src/services/identity.ts in the main ZeroAuth API so the
 * demo's commitments live in the same scalar field and would be
 * round-trip-verifiable on the existing /v1 surface if we ever wire
 * the bridge to it. The construction is:
 *
 *   biometricID      = SHA-256(slotSeed)              // 32 B
 *   biometricSecret  = Poseidon(biometricID_F, salt)  // BN128 scalar
 *   commitment       = Poseidon(biometricSecret, salt)
 *   didHash          = Poseidon(SHA-256(did)_F)
 *   identityBinding  = Poseidon(biometricSecret, didHash)
 *
 * The 31-byte truncation everywhere keeps inputs strictly inside the
 * BN128 scalar field (2^248 < p < 2^254) — same trick the main API
 * uses, same trick the circuit expects.
 *
 * The demo's "biometric template" is the **matched slot ID** from the
 * R307, not the raw characteristic bytes. The sensor's internal 1:N
 * match is acting as the fuzzy extractor: it maps a noisy finger
 * placement to a stable integer (the slot we enrolled into). Whether
 * a slot number is enough entropy for production is settled by the
 * Pramaan circuit work in /circuits — for a single-operator demo it's
 * the right shape.
 */

import { createHash, randomBytes } from 'node:crypto';
import { poseidon1, poseidon2 } from 'poseidon-lite';

/** BN128 scalar field modulus. Same constant snarkjs operates over. */
export const BN128_FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Patent step 1: SHA-256 of the biometric template. The template is the
 * stable 768-byte representation produced by `combineToTemplate()` on
 * the R307 — same finger → same template (modulo enrollment noise that
 * gets absorbed by combining two captures). The host treats this hash
 * as the device-derived biometric identity.
 */
export function biometricId(templateBytes: Buffer): Buffer {
  return createHash('sha256').update(templateBytes).digest();
}

/** Truncate a 32-byte buffer to 31 bytes and read as a big-endian bigint. */
export function toFieldElement(buf: Buffer): bigint {
  if (buf.length < 31) throw new Error(`toFieldElement: buffer too short (${buf.length})`);
  return BigInt('0x' + buf.subarray(0, 31).toString('hex'));
}

/** Random 31-byte salt as a BN128 field element. */
export function randomSalt(): bigint {
  return toFieldElement(randomBytes(31));
}

/** Patent step 4: biometricSecret = Poseidon(biometricID_F, salt). */
export function deriveBiometricSecret(biometricIDBuf: Buffer, salt: bigint): bigint {
  return poseidon2([toFieldElement(biometricIDBuf), salt]);
}

/** Patent step 5: commitment = Poseidon(biometricSecret, salt). */
export function computeCommitment(biometricSecret: bigint, salt: bigint): bigint {
  return poseidon2([biometricSecret, salt]);
}

/** DID identifier — stable per email. Public input, fine to derive locally. */
export function deriveDid(email: string): string {
  const suffix = createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
  return `did:zeroauth:demo:${suffix}`;
}

/** Patent step 6: didHash = Poseidon(SHA-256(did)_F). */
export function computeDidHash(did: string): bigint {
  const buf = createHash('sha256').update(did).digest();
  return poseidon1([toFieldElement(buf)]);
}

/** Circuit step 2: identityBinding = Poseidon(biometricSecret, didHash). */
export function computeIdentityBinding(biometricSecret: bigint, didHash: bigint): bigint {
  return poseidon2([biometricSecret, didHash]);
}

/**
 * One-call wrapper that produces every public + private signal the
 * identity_proof circuit consumes. `salt` is optional so the verify
 * leg can pass in the salt that was stored at signup; signup leaves
 * it undefined and we generate a fresh one.
 */
export interface IdentitySignals {
  biometricSecret: bigint;
  salt: bigint;
  commitment: bigint;
  didHash: bigint;
  identityBinding: bigint;
  did: string;
}

export function deriveSignals(input: {
  templateBytes: Buffer;
  email: string;
  salt?: bigint;
}): IdentitySignals {
  const bid = biometricId(input.templateBytes);
  const salt = input.salt ?? randomSalt();
  const biometricSecret = deriveBiometricSecret(bid, salt);
  const commitment = computeCommitment(biometricSecret, salt);
  const did = deriveDid(input.email);
  const didHash = computeDidHash(did);
  const identityBinding = computeIdentityBinding(biometricSecret, didHash);
  return { biometricSecret, salt, commitment, didHash, identityBinding, did };
}

/** Format helpers — short hex preview for the UI, full decimal for snarkjs. */
export function shortHex(n: bigint, width = 8): string {
  const hex = n.toString(16).padStart(64, '0');
  return `0x${hex.slice(0, width)}…${hex.slice(-4)}`;
}
