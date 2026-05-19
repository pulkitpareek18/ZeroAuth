/**
 * Groth16 prover + verifier for the demo. Wraps `snarkjs` against the
 * existing identity_proof circuit artifacts in `../../circuits/build`.
 *
 * The bridge calls fullProve at signup AND login. On signup the proof
 * proves the device just minted the commitment; on login it proves the
 * device still knows the secrets that derived the stored commitment.
 * In both cases the same artifact load is reused — the proving key and
 * verification key live in module-level singletons so we don't take
 * the ~1s loading cost on every request.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { groth16 } from 'snarkjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CIRCUIT_DIR = path.resolve(__dirname, '..', '..', 'circuits', 'build');
const WASM_PATH = path.join(CIRCUIT_DIR, 'identity_proof_js', 'identity_proof.wasm');
const ZKEY_PATH = path.join(CIRCUIT_DIR, 'circuit_final.zkey');
const VKEY_PATH = path.join(CIRCUIT_DIR, 'verification_key.json');

let verificationKey: object | null = null;

/**
 * Eagerly load the verification key + sanity-check the proving key
 * exists. Idempotent. Call once at bridge startup.
 */
export async function initProver(): Promise<void> {
  if (verificationKey) return;
  const [vkey, _zkey, _wasm] = await Promise.all([
    fs.readFile(VKEY_PATH, 'utf8').then((s) => JSON.parse(s)),
    fs.stat(ZKEY_PATH),
    fs.stat(WASM_PATH),
  ]);
  verificationKey = vkey;
}

/**
 * Generate a Groth16 proof for the identity_proof circuit.
 *
 * The circuit's interface (see circuits/identity_proof.circom):
 *   private: biometricSecret, salt
 *   public : commitment, didHash, identityBinding
 *
 * Returns the proof object + the public signals in canonical snarkjs
 * order (matches public input declaration in the circuit's `component
 * main` line).
 */
export interface Groth16Proof {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
  protocol: 'groth16';
  curve: 'bn128';
}

export interface ProveResult {
  proof: Groth16Proof;
  publicSignals: string[]; // [commitment, didHash, identityBinding] as decimal strings
}

export async function generateProof(input: {
  biometricSecret: bigint;
  salt: bigint;
  commitment: bigint;
  didHash: bigint;
  identityBinding: bigint;
}): Promise<ProveResult> {
  const witness = {
    biometricSecret: input.biometricSecret.toString(),
    salt: input.salt.toString(),
    commitment: input.commitment.toString(),
    didHash: input.didHash.toString(),
    identityBinding: input.identityBinding.toString(),
  };
  const { proof, publicSignals } = await groth16.fullProve(witness, WASM_PATH, ZKEY_PATH);
  return { proof: proof as Groth16Proof, publicSignals: publicSignals as string[] };
}

/**
 * Verify a Groth16 proof against the in-memory verification key. Returns
 * true on success, false otherwise. Never throws — the caller treats a
 * verification failure as "rejected," not "broken."
 */
export async function verifyProof(input: {
  proof: Groth16Proof;
  publicSignals: string[];
}): Promise<boolean> {
  if (!verificationKey) {
    await initProver();
  }
  try {
    return await groth16.verify(verificationKey!, input.publicSignals, input.proof);
  } catch {
    return false;
  }
}
