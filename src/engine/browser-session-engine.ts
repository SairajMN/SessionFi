/**
 * SessionFi Browser-Compatible Off-Chain Session Engine
 *
 * This is the core execution engine that manages session state transitions.
 * It operates off-chain but produces cryptographically verifiable state.
 *
 * Key responsibilities:
 * - Maintain active session state
 * - Validate and execute actions
 * - Enforce state transition rules
 * - Generate settlement proofs
 */

import {
  SessionState,
  Action,
  ActionType,
  StateTransitionResult,
  RejectionReason,
  SettlementProof,
  SessionMetadata,
  DeductParams,
  DepositParams,
  TransferParams,
} from "../core/types";
import {
  computeStateHash,
  computeActionLogRoot,
  signState,
} from "../crypto/browser-primitives";

// ============================================================================
// SESSION ENGINE CLASS
// ============================================================================

/**
 * BrowserSessionEngine manages the lifecycle and state transitions of sessions.
 *
 * Architecture:
 * - Stateless operation (each call is independent)
 * - Pure functions (deterministic state transitions)
 * - Explicit validation (fail fast on invalid transitions)
 */
export class BrowserSessionEngine {
  private enginePrivateKey: string;
  private enginePublicKey: string;

  constructor(enginePrivateKey: string, enginePublicKey: string) {
    this.enginePrivateKey = enginePrivateKey;
    this.enginePublicKey = enginePublicKey;
  }

  // ==========================================================================
  // SESSION INITIALIZATION
  // ==========================================================================

  /**
   * Create initial session state.
   *
   * This is called when a session is first opened.
   * Initial state has:
   * - Nonce 0
   * - Balances equal to locked assets
   * - Empty action log
   * - No previous state
   */
  createInitialState(
    sessionId: string,
    lockedAssets: Record<string, bigint>,
    userPublicKey: string,
  ): SessionState {
    // Initial balances = locked assets
    const balances = { ...lockedAssets };

    // Compute initial state hash
    const stateHash = computeStateHash(
      sessionId,
      0, // nonce starts at 0
      balances,
      null, // no previous state
      [], // no actions yet
    );

    // Create initial state (without signatures yet)
    const initialState: SessionState = {
      sessionId,
      nonce: 0,
      balances,
      previousStateHash: null,
      stateHash,
      actionLog: [],
      signatures: {
        user: "", // Will be filled after user signs
        engine: signState({ stateHash } as SessionState, this.enginePrivateKey),
      },
      timestamp: Date.now(),
    };

    return initialState;
  }

  // ==========================================================================
  // ACTION EXECUTION
  // ==========================================================================

  /**
   * Apply an action to current state, producing new state.
   *
   * This is the core state transition function.
   *
   * Process:
   * 1. Validate action against current state
   * 2. Compute new balances
   * 3. Create new state with updated values
   * 4. Compute new state hash
   * 5. Sign new state
   *
   * If validation fails, returns error without state change.
   */
  executeAction(
    currentState: SessionState,
    action: Action,
    userSignature: string,
    metadata: SessionMetadata,
  ): StateTransitionResult {
    // Validate action can be executed
    const validation = this.validateAction(currentState, action, metadata);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
        rejectionReason: validation.reason,
      };
    }

    // Compute new balances
    const newBalances = this.applyActionToBalances(
      currentState.balances,
      action,
    );

    if (!newBalances) {
      return {
        success: false,
        error: "Failed to apply action to balances",
        rejectionReason: RejectionReason.INSUFFICIENT_BALANCE,
      };
    }

    // Create new action log
    const newActionLog = [...currentState.actionLog, action];

    // Compute new state hash
    const newStateHash = computeStateHash(
      currentState.sessionId,
      currentState.nonce + 1,
      newBalances,
      currentState.stateHash,
      newActionLog,
    );

    // Create new state
    const newState: SessionState = {
      sessionId: currentState.sessionId,
      nonce: currentState.nonce + 1,
      balances: newBalances,
      previousStateHash: currentState.stateHash,
      stateHash: newStateHash,
      actionLog: newActionLog,
      signatures: {
        user: userSignature,
        engine: signState(
          { stateHash: newStateHash } as SessionState,
          this.enginePrivateKey,
        ),
      },
      timestamp: Date.now(),
    };

    return {
      success: true,
      newState,
    };
  }

  // ==========================================================================
  // ACTION VALIDATION
  // ==========================================================================

  /**
   * Validate that an action can be executed against current state.
   *
   * Checks:
   * - Action type is allowed
   * - Nonce is correct (sequential)
   * - Balances are sufficient
   * - Constraints are not violated
   */
  private validateAction(
    state: SessionState,
    action: Action,
    metadata: SessionMetadata,
  ): {
    valid: boolean;
    error?: string;
    reason?: RejectionReason;
  } {
    // Check action type is allowed
    if (!metadata.allowedActions.includes(action.type)) {
      return {
        valid: false,
        error: `Action type ${action.type} not allowed in this session`,
        reason: RejectionReason.ACTION_NOT_ALLOWED,
      };
    }

    // Check nonce is sequential
    if (action.nonce !== state.nonce + 1) {
      return {
        valid: false,
        error: `Invalid nonce: expected ${state.nonce + 1}, got ${action.nonce}`,
        reason: RejectionReason.INVALID_NONCE,
      };
    }

    // Validate action-specific logic
    switch (action.type) {
      case ActionType.DEDUCT:
        return this.validateDeduct(state, action.params as DeductParams);

      case ActionType.TRANSFER:
        return this.validateTransfer(state, action.params as TransferParams);

      case ActionType.DEPOSIT:
        return this.validateDeposit(state, action.params as DepositParams);

      default:
        return {
          valid: false,
          error: `Unknown action type: ${action.type}`,
          reason: RejectionReason.ACTION_NOT_ALLOWED,
        };
    }
  }

  private validateDeduct(
    state: SessionState,
    params: DeductParams,
  ): {
    valid: boolean;
    error?: string;
    reason?: RejectionReason;
  } {
    const currentBalance = state.balances[params.asset] || BigInt(0);

    if (currentBalance < params.amount) {
      return {
        valid: false,
        error: `Insufficient balance for ${params.asset}: have ${currentBalance}, need ${params.amount}`,
        reason: RejectionReason.INSUFFICIENT_BALANCE,
      };
    }

    return { valid: true };
  }

  private validateTransfer(
    state: SessionState,
    params: TransferParams,
  ): {
    valid: boolean;
    error?: string;
    reason?: RejectionReason;
  } {
    const fromBalance = state.balances[params.asset] || BigInt(0);

    if (fromBalance < params.amount) {
      return {
        valid: false,
        error: `Insufficient balance for transfer: have ${fromBalance}, need ${params.amount}`,
        reason: RejectionReason.INSUFFICIENT_BALANCE,
      };
    }

    return { valid: true };
  }

  private validateDeposit(
    _state: SessionState,
    _params: DepositParams,
  ): {
    valid: boolean;
    error?: string;
    reason?: RejectionReason;
  } {
    // Deposits always valid (adds to balance)
    // In production, would verify source and authorization
    return { valid: true };
  }

  // ==========================================================================
  // BALANCE MUTATIONS
  // ==========================================================================

  /**
   * Apply action to balances, producing new balance state.
   *
   * Returns null if action cannot be applied (e.g., insufficient balance).
   */
  private applyActionToBalances(
    currentBalances: Record<string, bigint>,
    action: Action,
  ): Record<string, bigint> | null {
    const newBalances = { ...currentBalances };

    switch (action.type) {
      case ActionType.DEDUCT: {
        const params = action.params as DeductParams;
        const current = newBalances[params.asset] || BigInt(0);

        if (current < params.amount) {
          return null; // Insufficient balance
        }

        newBalances[params.asset] = current - params.amount;
        return newBalances;
      }

      case ActionType.DEPOSIT: {
        const params = action.params as DepositParams;
        const current = newBalances[params.asset] || BigInt(0);
        newBalances[params.asset] = current + params.amount;
        return newBalances;
      }

      case ActionType.TRANSFER: {
        const params = action.params as TransferParams;
        const fromBalance = newBalances[params.asset] || BigInt(0);

        if (fromBalance < params.amount) {
          return null; // Insufficient balance
        }

        // In MVP, transfer just moves between conceptual accounts
        // For simplicity, we just deduct (simulate sending out)
        newBalances[params.asset] = fromBalance - params.amount;
        return newBalances;
      }

      default:
        return null;
    }
  }

  // ==========================================================================
  // SETTLEMENT PROOF GENERATION
  // ==========================================================================

  /**
   * Generate settlement proof from complete state history.
   *
   * This proof is submitted to the on-chain settlement contract.
   *
   * The proof contains:
   * - Complete state chain (for verification)
   * - Final state (for settlement)
   * - Action log merkle root (for compact verification)
   * - Final balances (for on-chain update)
   */
  generateSettlementProof(
    stateHistory: SessionState[],
    userSettlementSignature: string,
  ): SettlementProof {
    if (stateHistory.length === 0) {
      throw new Error("Cannot generate settlement proof: empty state history");
    }

    const finalState = stateHistory[stateHistory.length - 1];

    // Compute action log root
    const actionLogRoot = computeActionLogRoot(finalState.actionLog);

    return {
      stateHistory,
      finalState,
      actionLogRoot,
      totalActions: finalState.actionLog.length,
      finalBalances: finalState.balances,
      userSettlementSignature,
    };
  }

  // ==========================================================================
  // STATE VERIFICATION
  // ==========================================================================

  /**
   * Verify capital constraint: balances never exceed locked assets.
   *
   * This is a fundamental invariant of the protocol.
   * Violating this would allow value creation from nothing.
   */
  verifyCapitalConstraint(
    balances: Record<string, bigint>,
    lockedAssets: Record<string, bigint>,
  ): { valid: boolean; error?: string } {
    for (const asset in balances) {
      const balance = balances[asset];
      const locked = lockedAssets[asset] || BigInt(0);

      if (balance > locked) {
        return {
          valid: false,
          error: `Balance exceeds locked capital for ${asset}: ${balance} > ${locked}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Verify state transition is valid.
   *
   * Checks:
   * - Hash is correctly computed
   * - Previous state hash links correctly
   * - Nonce is sequential
   * - Signatures are present
   */
  verifyStateTransition(
    previousState: SessionState | null,
    newState: SessionState,
  ): { valid: boolean; error?: string } {
    // Verify hash computation
    const computedHash = computeStateHash(
      newState.sessionId,
      newState.nonce,
      newState.balances,
      newState.previousStateHash,
      newState.actionLog,
    );

    if (computedHash !== newState.stateHash) {
      return {
        valid: false,
        error: "State hash mismatch",
      };
    }

    // Verify chain linking
    if (previousState) {
      if (newState.previousStateHash !== previousState.stateHash) {
        return {
          valid: false,
          error: "State chain broken: previousStateHash mismatch",
        };
      }

      if (newState.nonce !== previousState.nonce + 1) {
        return {
          valid: false,
          error: `Nonce not sequential: ${previousState.nonce} -> ${newState.nonce}`,
        };
      }

      if (newState.sessionId !== previousState.sessionId) {
        return {
          valid: false,
          error: "Session ID mismatch",
        };
      }
    } else {
      // Initial state checks
      if (newState.nonce !== 0) {
        return {
          valid: false,
          error: `Initial state must have nonce 0, got ${newState.nonce}`,
        };
      }

      if (newState.previousStateHash !== null) {
        return {
          valid: false,
          error: "Initial state must have null previousStateHash",
        };
      }
    }

    // Verify signatures exist
    if (!newState.signatures.user || !newState.signatures.engine) {
      return {
        valid: false,
        error: "Missing signatures",
      };
    }

    return { valid: true };
  }
}

// ============================================================================
// ACTION BUILDERS (HELPER FUNCTIONS)
// ============================================================================

/**
 * Helper functions to construct well-formed actions.
 * These ensure type safety and correct parameter structure.
 */

export function createDeductAction(
  nonce: number,
  asset: string,
  amount: bigint,
  reason: string,
): Action {
  return {
    type: ActionType.DEDUCT,
    nonce,
    timestamp: Date.now(),
    params: {
      asset,
      amount,
      reason,
    },
  };
}

export function createDepositAction(
  nonce: number,
  asset: string,
  amount: bigint,
  source: string,
): Action {
  return {
    type: ActionType.DEPOSIT,
    nonce,
    timestamp: Date.now(),
    params: {
      asset,
      amount,
      source,
    },
  };
}

export function createTransferAction(
  nonce: number,
  asset: string,
  amount: bigint,
  from: string,
  to: string,
): Action {
  return {
    type: ActionType.TRANSFER,
    nonce,
    timestamp: Date.now(),
    params: {
      asset,
      amount,
      from,
      to,
    },
  };
}
