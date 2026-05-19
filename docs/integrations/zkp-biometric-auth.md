# ZKP Biometric Authentication

ZeroAuth's ZKP flow provides privacy-preserving biometric authentication. The server verifies a mathematical proof instead of retaining reusable biometric material — zero biometric data stored, ever.

## End-to-End Flow

1. The client captures a biometric template.
2. The client submits the template to `POST /v1/auth/zkp/register` via the ZeroAuth API.
3. ZeroAuth derives identity materials and optionally anchors the biometric hash to a DID on Base Sepolia.
4. ZeroAuth returns `did`, `commitment`, `didHash`, `biometricSecret`, and `salt`.
5. The client stores `biometricSecret` and `salt` securely.
6. The client generates a Groth16 proof locally.
7. The client requests a fresh nonce from `GET /v1/auth/zkp/nonce`.
8. The client submits the proof, public signals, nonce, and timestamp to `POST /v1/auth/zkp/verify`.
9. ZeroAuth verifies the proof and issues JWTs on success.

## Registration

### Request

```bash
curl -X POST https://api.zeroauth.dev/v1/auth/zkp/register \
  -H "Authorization: Bearer za_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "biometricTemplate": "<base64-encoded-template>"
  }'
```

### Success response

```json
{
  "did": "did:zeroauth:base:9d32c2b87ebfa39cbe3f1a0e103b65d9",
  "commitment": "1877552082745230970102393847",
  "didHash": "8181234412277001983374",
  "biometricSecret": "1569829922277132991011",
  "salt": "5566092238018732991001",
  "txHash": "0xabc123...",
  "blockNumber": 24801234,
  "dataStored": false,
  "message": "Identity registered. Store biometricSecret and salt securely — they will not be sent again. Zero biometric data stored on server."
}
```

### Validation rules

- `biometricTemplate` must be a string.
- The decoded template must be at least 16 bytes.
- Your API key must have the `zkp:register` scope.

## Identity Materials Returned to the Client

### `did`

The decentralized identifier generated for this user in the form:

```text
did:zeroauth:base:<32 hex chars>
```

### `commitment`

Poseidon commitment used as a public circuit input.

### `didHash`

Poseidon-compatible DID hash used as a public circuit input.

### `biometricSecret`

A client-held secret derived from the SHA-256 biometric hash and the generated salt.

### `salt`

A random field-safe value used in commitment derivation and proof generation.

## Client-Side Proof Generation

The server never generates proofs. The client must do that locally.

The circuit expects:

- private inputs: `biometricSecret`, `salt`
- public inputs: `commitment`, `didHash`, `identityBinding`

`identityBinding` is defined by the circuit as:

```text
Poseidon(biometricSecret, didHash)
```

Example browser or Node client flow:

```ts
import * as snarkjs from 'snarkjs';
import { buildPoseidon } from 'circomlibjs';

const poseidon = await buildPoseidon();
const F = poseidon.F;

const identityBinding = F.toString(
  poseidon([BigInt(biometricSecret), BigInt(didHash)])
);

const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  {
    biometricSecret,
    salt,
    commitment,
    didHash,
    identityBinding
  },
  wasmPath,
  zkeyPath
);
```

Artifacts you need on the client side:

- `identity_proof.wasm`
- `circuit_final.zkey`

You can inspect the configured circuit metadata from:

```bash
curl https://api.zeroauth.dev/v1/auth/zkp/circuit-info \
  -H "Authorization: Bearer za_live_YOUR_KEY"
```

The API does not directly expose the proving key, so most teams either:

- package the `zkey` with a frontend SDK, or
- host it as a static artifact separately.

## Nonce and Freshness

Fetch a nonce before proof submission:

```bash
curl https://api.zeroauth.dev/v1/auth/zkp/nonce \
  -H "Authorization: Bearer za_live_YOUR_KEY"
```

Example response:

```json
{
  "nonce": "8eb8b0db-c143-4e29-8e6c-6c26078ba2c8",
  "timestamp": "2026-03-14T10:15:30.000Z",
  "expiresIn": 300
}
```

Verification checks:

- the nonce must be a UUID v4,
- the submitted timestamp must be within five minutes of server time.

## Proof Verification

### Request

```bash
curl -X POST https://api.zeroauth.dev/v1/auth/zkp/verify \
  -H "Authorization: Bearer za_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "proof": {
      "pi_a": ["1", "2", "1"],
      "pi_b": [["1", "2"], ["3", "4"], ["1", "0"]],
      "pi_c": ["5", "6", "1"],
      "protocol": "groth16",
      "curve": "bn128"
    },
    "publicSignals": [
      "<commitment>",
      "<didHash>",
      "<identityBinding>"
    ],
    "nonce": "<uuid-v4>",
    "timestamp": "2026-03-14T10:15:30.000Z"
  }'
```

### Success response

```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<jwt>",
  "tokenType": "Bearer",
  "expiresIn": 3600,
  "verified": true,
  "sessionId": "6e92d480-9d01-4892-8ca4-7012910d8bf4",
  "provider": "zkp",
  "dataStorageConfirmation": {
    "biometricDataStored": false,
    "message": "Zero biometric data stored. Ever. Breach-proof by architecture."
  }
}
```

### Failure response

```json
{
  "verified": false,
  "error": "Biometric proof verification failed",
  "dataStored": false,
  "message": "Zero biometric data stored. Ever. Breach-proof by architecture."
}
```

## Verification Modes

### Off-chain verification

ZeroAuth verifies the Groth16 proof using `snarkjs.groth16.verify(...)` with the loaded verification key. This is the default operating mode.

### On-chain verification

When enabled for your account, ZeroAuth also calls the Groth16 verifier contract on Base Sepolia after off-chain verification passes. On-chain verification is available on Starter plans and above.

## Recommended Client Responsibilities

- Never send raw biometric templates during verification.
- Store `biometricSecret` and `salt` securely after registration.
- Treat registration response values as unrecoverable from the server once lost.
- Fetch a fresh nonce immediately before proof submission.
- Pin artifact versions so the circuit, proving key, verification key, and Solidity verifier all match.

For endpoint-level details, see [API Reference](../reference/api-reference.md).
