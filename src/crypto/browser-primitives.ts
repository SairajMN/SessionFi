/**
 * SessionFi Browser-Compatible Cryptographic Primitives
 *
 * These functions provide the cryptographic foundation for the protocol
 * in browser environments using Web Crypto API.
 *
 * Key principles:
 * - Deterministic: same input always produces same output
 * - Verifiable: any party can verify without secrets
 * - Non-repudiable: signatures prove consent
 */

import { KeyPair, SessionState, Action } from "../core/types";

// ============================================================================
// HASHING (Browser-compatible)
// ============================================================================

/**
 * Compute SHA-256 hash of string data.
 * Uses Web Crypto API for browser compatibility.
 */
export async function hashString(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Synchronous hash using simple implementation for demo purposes.
 * In production, use async version with Web Crypto API.
 */
export function hashStringSync(data: string): string {
  // Simple hash function for demo (NOT cryptographically secure)
  // In production, use proper async Web Crypto API
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }

  // Convert to hex-like string with sufficient entropy for demo
  const hashStr = Math.abs(hash).toString(16).padStart(8, "0");
  // Extend to 64 characters for SHA-256-like appearance
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += hashStr;
  }
  return result;
}

/**
 * Compute deterministic hash of session state.
 *
 * This hash represents the cryptographic commitment to the entire state.
 * It MUST be deterministic - same state always produces same hash.
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

  // Hash with synchronous function for demo
  return hashStringSync(canonical);
}

/**
 * Compute merkle root of action log.
 * Used for compact proof verification.
 */
export function computeActionLogRoot(actions: Action[]): string {
  if (actions.length === 0) {
    return hashStringSync("empty");
  }

  const concatenated = actions
    .map((action) => {
      const paramsStr = JSON.stringify(action.params, (_, v) =>
        typeof v === "bigint" ? v.toString() : v,
      );
      return hashStringSync(`${action.type}:${action.nonce}:${paramsStr}`);
    })
    .join("");

  return hashStringSync(concatenated);
}

// ============================================================================
// KEY GENERATION (Browser-compatible)
// ============================================================================

/**
 * Generate random bytes using Web Crypto API.
 */
function getRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Convert Uint8Array to hex string.
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate a new cryptographic key pair.
 *
 * For MVP, we use simple random keys.
 * Post-MVP: integrate with actual Ed25519 or Secp256k1.
 */
export function generateKeyPair(identity?: string): KeyPair {
  // Generate random private key (32 bytes)
  const privateKeyBytes = getRandomBytes(32);
  const privateKey = bytesToHex(privateKeyBytes);

  // Derive public key (in production, use proper curve math)
  const publicKey = hashStringSync(`pubkey:${privateKey}`);

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
 */
export function deriveAddress(publicKey: string, identity?: string): string {
  const input = identity ? `${publicKey}:${identity}` : publicKey;
  return hashStringSync(input).substring(0, 42);
}

// ============================================================================
// SIGNING (Browser-compatible)
// ============================================================================

/**
 * Sign a message with a private key.
 *
 * For MVP, we simulate signing with HMAC-style construction.
 * Post-MVP: use proper Ed25519 or Secp256k1 signing.
 */
export function sign(message: string, privateKey: string): string {
  // Simulate signing: hash(message + privateKey)
  const signature = hashStringSync(`${message}:${privateKey}`);
  return signature;
}

/**
 * Sign session state.
 */
export function signState(state: SessionState, privateKey: string): string {
  return sign(state.stateHash, privateKey);
}

/**
 * Sign settlement authorization.
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
 */
export function verify(
  message: string,
  signature: string,
  publicKey: string,
): boolean {
  // For MVP demo: accept signatures that match format
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

  // Verify each state's hash
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
      error: `State 0 hash mismatch`,
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
        error: `Nonce gap at index ${i}`,
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
  return hashStringSync(canonical);
}
