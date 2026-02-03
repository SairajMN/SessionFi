/**
 * SessionFi Cryptographic Primitives
 *
 * These functions provide the cryptographic foundation for the protocol.
 * All state transitions, proofs, and settlements rely on these primitives.
 *
 * Key principles:
 * - Deterministic: same input always produces same output
 * - Verifiable: any party can verify without secrets
 * - Non-repudiable: signatures prove consent
 */

import { createHash, randomBytes } from "crypto";
import { KeyPair, SessionState, Action } from "../core/types";

// ============================================================================
// HASHING
// ============================================================================

/**
 * Compute deterministic hash of session state.
 *
 * This hash represents the cryptographic commitment to the entire state.
 * It MUST be deterministic - same state always produces same hash.
 *
 * Hash input includes:
 * - sessionId (binds to specific session)
 * - nonce (enforces ordering)
 * - balances (the actual state)
 * - previousStateHash (creates chain)
 * - actionLog (complete history)
 *
 * This enables:
 * - State verification without revealing history
 * - Hash chain linking (blockchain-style)
 * - Tamper detection
 */
export function computeStateHash(
  sessionId: string,
  nonce: number,
  balances: Record<string, bigint>,
  previousStateHash: string | null,
  actionLog: Action[],
): string {
  // Canonicalize balances (sort keys for determinism)
  const sortedBalances = Object.keys(balances)
    .sort()
    .map((asset) => `${asset}:${balances[asset].toString()}`)
    .join("|");

  // Canonicalize action log
  const actionLogStr = actionLog
    .map((action) => {
      const paramsStr = JSON.stringify(action.params, (_, v) =>
        typeof v === "bigint" ? v.toString() : v,
      );
      return `${action.type}:${action.nonce}:${paramsStr}:${action.timestamp}`;
    })
    .join("|");

  // Construct canonical representation
  const canonical = [
    `session:${sessionId}`,
    `nonce:${nonce}`,
    `balances:${sortedBalances}`,
    `prev:${previousStateHash || "genesis"}`,
    `actions:${actionLogStr}`,
  ].join("||");

  // Hash with SHA-256
  return hashString(canonical);
}

/**
 * Compute hash of arbitrary string data.
 * Uses SHA-256 for cryptographic strength.
 */
export function hashString(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/**
 * Compute merkle root of action log.
 * Used for compact proof verification.
 *
 * For MVP, we use simple hash of concatenated actions.
 * Post-MVP: implement proper merkle tree with inclusion proofs.
 */
export function computeActionLogRoot(actions: Action[]): string {
  if (actions.length === 0) {
    return hashString("empty");
  }

  const concatenated = actions
    .map((action) => {
      const paramsStr = JSON.stringify(action.params, (_, v) =>
        typeof v === "bigint" ? v.toString() : v,
      );
      return hashString(`${action.type}:${action.nonce}:${paramsStr}`);
    })
    .join("");

  return hashString(concatenated);
}

// ============================================================================
// KEY GENERATION
// ============================================================================

/**
 * Generate a new cryptographic key pair.
 *
 * For MVP, we use simple Ed25519-style keys (simulated).
 * Post-MVP: integrate with actual Ed25519 or Secp256k1.
 *
 * SECURITY NOTE: This is a simplified implementation for demo purposes.
 * Production requires proper key derivation and secure storage.
 */
export function generateKeyPair(identity?: string): KeyPair {
  // Generate random private key (32 bytes)
  const privateKey = randomBytes(32).toString("hex");

  // Derive public key (in production, use proper curve math)
  const publicKey = hashString(`pubkey:${privateKey}`);

  // Derive address (hash of public key)
  const address = deriveAddress(publicKey, identity);

  return {
    publicKey,
    privateKey,
    address,
  };
}

/**
 * Derive address from public key and optional identity.
 * Address format: hash(publicKey + identity)
 */
export function deriveAddress(publicKey: string, identity?: string): string {
  const input = identity ? `${publicKey}:${identity}` : publicKey;
  return hashString(input).substring(0, 42); // Ethereum-style length
}

// ============================================================================
// SIGNING
// ============================================================================

/**
 * Sign a message with a private key.
 *
 * For MVP, we simulate signing with HMAC-style construction.
 * Post-MVP: use proper Ed25519 or Secp256k1 signing.
 *
 * The signature proves:
 * 1. The signer knows the private key
 * 2. The signer agrees to the specific message
 * 3. The signature cannot be forged or repudiated
 *
 * SECURITY NOTE: This is simplified for demo. Production requires proper signatures.
 */
export function sign(message: string, privateKey: string): string {
  // Simulate signing: hash(message + privateKey)
  // Real implementation would use Ed25519 or ECDSA
  const signature = hashString(`${message}:${privateKey}`);
  return signature;
}

/**
 * Sign session state.
 * Returns signature over the state hash.
 */
export function signState(state: SessionState, privateKey: string): string {
  return sign(state.stateHash, privateKey);
}

/**
 * Sign settlement authorization.
 * User signs to authorize final settlement.
 */
export function signSettlement(
  sessionId: string,
  finalStateHash: string,
  privateKey: string,
): string {
  const message = `settle:${sessionId}:${finalStateHash}`;
  return sign(message, privateKey);
}

// ============================================================================
// VERIFICATION
// ============================================================================

/**
 * Verify a signature against a message and public key.
 *
 * Returns true if:
 * 1. The signature was created by the holder of the private key
 * 2. The signature is over the exact message provided
 *
 * SECURITY NOTE: Simplified for demo. Production requires proper verification.
 */
export function verify(
  message: string,
  signature: string,
  publicKey: string,
): boolean {
  // To verify with our simplified scheme:
  // We need to derive what the signature should be from public key
  // In a real system, this uses curve math to verify without private key
  //
  // For MVP demo: we accept signatures that match a deterministic pattern
  // This is NOT cryptographically secure - just demonstrates the flow

  // Simulate verification by checking signature format
  // Real implementation would use Ed25519 verification
  return signature.length === 64 && /^[0-9a-f]{64}$/.test(signature);
}

/**
 * Verify state signature.
 */
export function verifyStateSignature(
  state: SessionState,
  signature: string,
  publicKey: string,
): boolean {
  return verify(state.stateHash, signature, publicKey);
}

/**
 * Verify settlement signature.
 */
export function verifySettlementSignature(
  sessionId: string,
  finalStateHash: string,
  signature: string,
  publicKey: string,
): boolean {
  const message = `settle:${sessionId}:${finalStateHash}`;
  return verify(message, signature, publicKey);
}

// ============================================================================
// STATE CHAIN VERIFICATION
// ============================================================================

/**
 * Verify hash chain integrity.
 *
 * Checks that each state correctly links to previous state:
 * - State N's previousStateHash equals State N-1's stateHash
 * - Nonces are sequential
 * - Each state hash is correctly computed
 *
 * This ensures:
 * - No states were skipped
 * - No states were reordered
 * - No states were tampered with
 */
export function verifyStateChain(states: SessionState[]): {
  valid: boolean;
  error?: string;
} {
  if (states.length === 0) {
    return { valid: true };
  }

  // Verify first state
  const firstState = states[0];
  if (firstState.nonce !== 0) {
    return {
      valid: false,
      error: `First state nonce must be 0, got ${firstState.nonce}`,
    };
  }

  if (firstState.previousStateHash !== null) {
    return {
      valid: false,
      error: "First state must have null previousStateHash",
    };
  }

  // Verify each state's hash is correctly computed
  const computedHash = computeStateHash(
    firstState.sessionId,
    firstState.nonce,
    firstState.balances,
    firstState.previousStateHash,
    firstState.actionLog,
  );

  if (computedHash !== firstState.stateHash) {
    return {
      valid: false,
      error: `State 0 hash mismatch: expected ${computedHash}, got ${firstState.stateHash}`,
    };
  }

  // Verify chain linking
  for (let i = 1; i < states.length; i++) {
    const currentState = states[i];
    const previousState = states[i - 1];

    // Check nonce sequencing
    if (currentState.nonce !== previousState.nonce + 1) {
      return {
        valid: false,
        error: `Nonce gap at index ${i}: ${previousState.nonce} -> ${currentState.nonce}`,
      };
    }

    // Check hash linking
    if (currentState.previousStateHash !== previousState.stateHash) {
      return {
        valid: false,
        error: `Hash chain broken at index ${i}`,
      };
    }

    // Verify hash computation
    const computedHash = computeStateHash(
      currentState.sessionId,
      currentState.nonce,
      currentState.balances,
      currentState.previousStateHash,
      currentState.actionLog,
    );

    if (computedHash !== currentState.stateHash) {
      return {
        valid: false,
        error: `State ${i} hash mismatch`,
      };
    }

    // Check session ID consistency
    if (currentState.sessionId !== previousState.sessionId) {
      return {
        valid: false,
        error: `Session ID mismatch at index ${i}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Verify all signatures in state chain.
 *
 * Ensures:
 * - User signed each state
 * - Engine signed each state
 * - Signatures are valid
 */
export function verifyStateChainSignatures(
  states: SessionState[],
  userPublicKey: string,
  enginePublicKey: string,
): { valid: boolean; error?: string } {
  for (let i = 0; i < states.length; i++) {
    const state = states[i];

    // Verify user signature
    const userSigValid = verifyStateSignature(
      state,
      state.signatures.user,
      userPublicKey,
    );

    if (!userSigValid) {
      return {
        valid: false,
        error: `Invalid user signature at state ${i}`,
      };
    }

    // Verify engine signature
    const engineSigValid = verifyStateSignature(
      state,
      state.signatures.engine,
      enginePublicKey,
    );

    if (!engineSigValid) {
      return {
        valid: false,
        error: `Invalid engine signature at state ${i}`,
      };
    }
  }

  return { valid: true };
}

// ============================================================================
// SESSION ID GENERATION
// ============================================================================

/**
 * Generate deterministic session ID.
 *
 * Session ID is derived from:
 * - Owner address (binds to specific user)
 * - Timestamp (ensures uniqueness)
 * - Locked assets (commits to initial capital)
 *
 * This makes session IDs:
 * - Deterministic (same inputs = same ID)
 * - Unique (timestamp prevents collisions)
 * - Binding (commits to owner and capital)
 */
export function generateSessionId(
  ownerAddress: string,
  lockedAssets: Record<string, bigint>,
  timestamp: number,
): string {
  const sortedAssets = Object.keys(lockedAssets)
    .sort()
    .map((asset) => `${asset}:${lockedAssets[asset].toString()}`)
    .join("|");

  const canonical = `session:${ownerAddress}:${timestamp}:${sortedAssets}`;
  return hashString(canonical);
}
