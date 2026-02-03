/**
 * SessionFi Protocol Core Types
 *
 * These types define the fundamental data structures of the SessionFi protocol.
 * Every type maps directly to a protocol-level concept, not an implementation convenience.
 */

// ============================================================================
// SESSION LIFECYCLE STATES
// ============================================================================

/**
 * Session lifecycle is explicit and linear.
 * State transitions are irreversible to maintain protocol integrity.
 */
export enum SessionStatus {
  CREATED = "CREATED", // Session object created, awaiting activation
  ACTIVE = "ACTIVE", // Off-chain state channel open, actions permitted
  SETTLING = "SETTLING", // Settlement initiated, no new actions
  SETTLED = "SETTLED", // Final state verified and settled on-chain
  CLOSED = "CLOSED", // Session finalized, object immutable
  DISPUTED = "DISPUTED", // Challenge raised, dispute resolution active
}

// ============================================================================
// ON-CHAIN SESSION OBJECT
// ============================================================================

/**
 * SessionObject represents the on-chain truth.
 * This is what exists on Sui as an owned object.
 *
 * Key properties:
 * - Immutable after settlement
 * - Owns locked capital
 * - Contains cryptographic commitment to off-chain state
 */
export interface SessionObject {
  // Unique session identifier (deterministic hash)
  sessionId: string;

  // Owner identity (ENS-style human-readable)
  ownerEns: string;

  // Owner's cryptographic address
  ownerAddress: string;

  // Locked capital per asset
  lockedAssets: Record<string, bigint>;

  // Session lifecycle state
  status: SessionStatus;

  // Session creation timestamp
  startTime: number;

  // Session settlement timestamp (null until settled)
  settlementTime: number | null;

  // Cryptographic commitment to final off-chain state
  // This hash is verified during settlement
  finalStateHash: string | null;

  // Settlement proof bundle (submitted during settlement)
  settlementProof: SettlementProof | null;
}

// ============================================================================
// OFF-CHAIN SESSION STATE
// ============================================================================

/**
 * SessionState represents the evolving off-chain state.
 * This is NOT stored on-chain during the session.
 * Only the final hash is committed on-chain at settlement.
 *
 * Key properties:
 * - Hash-linked to previous state (blockchain-style chain)
 * - Dual-signature (user + engine) for every transition
 * - Nonce prevents replay attacks and enforces ordering
 * - Self-contained: can be verified independently
 */
export interface SessionState {
  // References the on-chain session
  sessionId: string;

  // State version number (monotonically increasing)
  nonce: number;

  // Current balances per asset
  // Invariant: sum(balances) <= sum(lockedAssets)
  balances: Record<string, bigint>;

  // Hash of previous state (forms chain)
  // null for initial state
  previousStateHash: string | null;

  // Hash of current state
  // Computed from: hash(sessionId, nonce, balances, previousStateHash, actionLog)
  stateHash: string;

  // All actions applied to reach this state
  // Complete history enables verification
  actionLog: Action[];

  // Dual signatures prove consent
  signatures: StateSignatures;

  // Timestamp of state creation
  timestamp: number;
}

/**
 * Dual signatures ensure both parties agree on state transition.
 * Missing signature = invalid state.
 */
export interface StateSignatures {
  // User signature over stateHash
  user: string;

  // Engine signature over stateHash
  engine: string;
}

// ============================================================================
// ACTIONS (ABSTRACT PROTOCOL INTERFACE)
// ============================================================================

/**
 * Action represents ANY state transition in the session.
 * This is abstract by design - the protocol doesn't prescribe what actions do.
 *
 * In the MVP, actions are simple balance mutations.
 * Post-MVP, actions could be:
 * - DEX trades
 * - Lending operations
 * - NFT transfers
 * - Cross-chain messages
 *
 * Key properties:
 * - Deterministic: same action + state → same new state
 * - Atomic: either fully applied or rejected
 * - Verifiable: any party can verify validity
 */
export interface Action {
  // Action type (extensible)
  type: ActionType;

  // Action-specific parameters
  params: ActionParams;

  // Nonce at which action was applied
  nonce: number;

  // Timestamp of action submission
  timestamp: number;
}

export enum ActionType {
  // MVP action types (simple balance mutations)
  TRANSFER = "TRANSFER", // Transfer between internal accounts
  DEDUCT = "DEDUCT", // Reduce balance (simulate fees/costs)
  DEPOSIT = "DEPOSIT", // Increase balance (simulate income)

  // Future action types (post-MVP)
  TRADE = "TRADE", // DEX trade
  LEND = "LEND", // Lending protocol interaction
  STAKE = "STAKE", // Staking operation
}

/**
 * ActionParams is a discriminated union based on ActionType.
 * Type-safe action parameters.
 */
export type ActionParams = TransferParams | DeductParams | DepositParams;

export interface TransferParams {
  asset: string;
  amount: bigint;
  from: string;
  to: string;
}

export interface DeductParams {
  asset: string;
  amount: bigint;
  reason: string;
}

export interface DepositParams {
  asset: string;
  amount: bigint;
  source: string;
}

// ============================================================================
// SETTLEMENT PROOF
// ============================================================================

/**
 * SettlementProof is the cryptographic proof bundle submitted at settlement.
 * This is what the on-chain contract verifies.
 *
 * Verification checks:
 * 1. State hash chain is valid (each hash links correctly)
 * 2. All states have dual signatures
 * 3. Nonces are sequential and complete
 * 4. Final balances respect capital constraints
 * 5. No double-signing or replays
 *
 * If verification passes, settlement is atomic and final.
 */
export interface SettlementProof {
  // Complete state history (or merkle proof in optimized version)
  stateHistory: SessionState[];

  // Final state (redundant but explicit)
  finalState: SessionState;

  // Merkle root of complete action log (for compact verification)
  actionLogRoot: string;

  // Total number of actions executed
  totalActions: number;

  // Final balances to be settled
  finalBalances: Record<string, bigint>;

  // Signature from user authorizing settlement
  userSettlementSignature: string;
}

// ============================================================================
// SESSION METADATA
// ============================================================================

/**
 * SessionMetadata contains session configuration and constraints.
 * Set at session creation, immutable during execution.
 */
export interface SessionMetadata {
  sessionId: string;
  ownerEns: string;
  ownerAddress: string;

  // Maximum session duration (seconds)
  maxDuration: number;

  // Timeout for settlement (seconds after end session called)
  settlementTimeout: number;

  // Allowed action types
  allowedActions: ActionType[];

  // Per-action constraints (optional)
  actionConstraints?: ActionConstraints;
}

export interface ActionConstraints {
  // Maximum balance deduction per action
  maxDeductionPerAction?: Record<string, bigint>;

  // Maximum total deduction across session
  maxTotalDeduction?: Record<string, bigint>;

  // Rate limiting (actions per second)
  maxActionsPerSecond?: number;
}

// ============================================================================
// ENGINE TYPES
// ============================================================================

/**
 * EngineState tracks the off-chain engine's view of active sessions.
 */
export interface EngineState {
  activeSessions: Map<string, SessionState>;
  pendingSettlements: Map<string, SettlementProof>;
}

/**
 * StateTransitionResult encapsulates the outcome of applying an action.
 */
export interface StateTransitionResult {
  success: boolean;
  newState?: SessionState;
  error?: string;
  rejectionReason?: RejectionReason;
}

export enum RejectionReason {
  INVALID_NONCE = "INVALID_NONCE",
  INSUFFICIENT_BALANCE = "INSUFFICIENT_BALANCE",
  INVALID_SIGNATURE = "INVALID_SIGNATURE",
  SESSION_NOT_ACTIVE = "SESSION_NOT_ACTIVE",
  ACTION_NOT_ALLOWED = "ACTION_NOT_ALLOWED",
  CONSTRAINT_VIOLATION = "CONSTRAINT_VIOLATION",
}

// ============================================================================
// CRYPTOGRAPHIC PRIMITIVES
// ============================================================================

/**
 * KeyPair represents a cryptographic identity.
 */
export interface KeyPair {
  publicKey: string;
  privateKey: string;
  address: string;
}

/**
 * SignedMessage wraps a message with its signature.
 */
export interface SignedMessage<T> {
  message: T;
  signature: string;
  signer: string;
}
