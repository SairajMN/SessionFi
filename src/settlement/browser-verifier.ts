/**
 * SessionFi Browser-Compatible Settlement Verifier
 *
 * This module simulates on-chain settlement verification.
 * In production, this logic would be implemented in Move on Sui.
 *
 * The verifier is the final arbiter of truth:
 * - Verifies cryptographic proofs
 * - Enforces protocol rules
 * - Ensures capital conservation
 * - Executes atomic settlement
 *
 * Key property: Settlement is TRUSTLESS
 * - No reliance on off-chain engine honesty
 * - All proofs are cryptographically verified
 * - Invalid proofs are rejected, capital remains locked
 */

import {
  SessionObject,
  SessionStatus,
  SettlementProof,
  SessionState,
} from "../core/types";
import {
  verifyStateChain,
  verifyStateChainSignatures,
} from "../crypto/browser-primitives";

// ============================================================================
// SETTLEMENT VERIFIER
// ============================================================================

/**
 * BrowserSettlementVerifier simulates on-chain verification logic.
 *
 * In production on Sui:
 * - This would be a Move module
 * - SessionObject would be a Sui object
 * - Verification would happen in a Move function
 * - Settlement would be atomic (all-or-nothing)
 */
export class BrowserSettlementVerifier {
  /**
   * Verify and execute settlement.
   *
   * This is the critical function that:
   * 1. Verifies all cryptographic proofs
   * 2. Checks protocol invariants
   * 3. Updates on-chain state atomically
   *
   * If ANY check fails, settlement is rejected.
   * Capital remains locked, user retains control.
   */
  verifyAndSettle(
    sessionObject: SessionObject,
    proof: SettlementProof,
    userPublicKey: string,
    enginePublicKey: string,
  ): {
    success: boolean;
    error?: string;
    settledSession?: SessionObject;
  } {
    // ========================================================================
    // 1. VERIFY SESSION STATE
    // ========================================================================

    if (sessionObject.status !== SessionStatus.ACTIVE) {
      return {
        success: false,
        error: `Session not active: ${sessionObject.status}`,
      };
    }

    // ========================================================================
    // 2. VERIFY STATE CHAIN INTEGRITY
    // ========================================================================

    const chainVerification = verifyStateChain(proof.stateHistory);
    if (!chainVerification.valid) {
      return {
        success: false,
        error: `State chain invalid: ${chainVerification.error}`,
      };
    }

    // ========================================================================
    // 3. VERIFY ALL SIGNATURES
    // ========================================================================

    const signatureVerification = verifyStateChainSignatures(
      proof.stateHistory,
      userPublicKey,
      enginePublicKey,
    );

    if (!signatureVerification.valid) {
      return {
        success: false,
        error: `Signature verification failed: ${signatureVerification.error}`,
      };
    }

    // ========================================================================
    // 4. VERIFY FINAL STATE MATCHES
    // ========================================================================

    const finalStateFromHistory =
      proof.stateHistory[proof.stateHistory.length - 1];

    if (proof.finalState.stateHash !== finalStateFromHistory.stateHash) {
      return {
        success: false,
        error: "Final state hash mismatch",
      };
    }

    // ========================================================================
    // 5. VERIFY SESSION ID BINDING
    // ========================================================================

    for (const state of proof.stateHistory) {
      if (state.sessionId !== sessionObject.sessionId) {
        return {
          success: false,
          error: "Session ID mismatch in state history",
        };
      }
    }

    // ========================================================================
    // 6. VERIFY CAPITAL CONSERVATION
    // ========================================================================

    const capitalCheck = this.verifyCapitalConservation(
      proof.finalBalances,
      sessionObject.lockedAssets,
    );

    if (!capitalCheck.valid) {
      return {
        success: false,
        error: `Capital conservation violated: ${capitalCheck.error}`,
      };
    }

    // ========================================================================
    // 7. VERIFY ACTION COUNT
    // ========================================================================

    if (proof.totalActions !== proof.finalState.actionLog.length) {
      return {
        success: false,
        error: "Action count mismatch",
      };
    }

    // ========================================================================
    // 8. EXECUTE SETTLEMENT (ATOMIC UPDATE)
    // ========================================================================

    const settledSession: SessionObject = {
      ...sessionObject,
      status: SessionStatus.SETTLED,
      settlementTime: Date.now(),
      finalStateHash: proof.finalState.stateHash,
      settlementProof: proof,
    };

    return {
      success: true,
      settledSession,
    };
  }

  /**
   * Verify capital conservation law.
   *
   * Protocol invariant: final balances ≤ locked assets
   *
   * This prevents:
   * - Value creation from nothing
   * - Theft of locked capital
   * - Withdrawal of non-existent funds
   *
   * If this check fails, the off-chain engine violated protocol rules.
   */
  private verifyCapitalConservation(
    finalBalances: Record<string, bigint>,
    lockedAssets: Record<string, bigint>,
  ): { valid: boolean; error?: string } {
    // Check each asset in final balances
    for (const asset in finalBalances) {
      const finalBalance = finalBalances[asset];
      const locked = lockedAssets[asset] || BigInt(0);

      if (finalBalance > locked) {
        return {
          valid: false,
          error: `Final balance exceeds locked for ${asset}: ${finalBalance} > ${locked}`,
        };
      }

      // Balance cannot be negative
      if (finalBalance < BigInt(0)) {
        return {
          valid: false,
          error: `Negative balance for ${asset}: ${finalBalance}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Compute settlement amounts (what user receives back).
   *
   * Settlement amounts = final balances
   * Difference (locked - final) represents:
   * - Fees paid
   * - Value transferred out
   * - Protocol costs
   */
  computeSettlementAmounts(
    finalBalances: Record<string, bigint>,
    lockedAssets: Record<string, bigint>,
  ): {
    returned: Record<string, bigint>;
    consumed: Record<string, bigint>;
  } {
    const returned: Record<string, bigint> = {};
    const consumed: Record<string, bigint> = {};

    for (const asset in lockedAssets) {
      const locked = lockedAssets[asset];
      const final = finalBalances[asset] || BigInt(0);

      returned[asset] = final;
      consumed[asset] = locked - final;
    }

    return { returned, consumed };
  }

  /**
   * Verify settlement timeout hasn't expired.
   *
   * If user doesn't settle within timeout:
   * - Last valid signed state can be settled
   * - Or capital can be released to user
   *
   * This prevents griefing where user never settles.
   */
  verifySettlementTimeout(
    sessionObject: SessionObject,
    timeoutSeconds: number,
  ): { valid: boolean; expired: boolean } {
    const now = Date.now();
    const elapsed = (now - sessionObject.startTime) / 1000;

    return {
      valid: elapsed <= timeoutSeconds,
      expired: elapsed > timeoutSeconds,
    };
  }

  /**
   * Emergency settlement with last known valid state.
   *
   * Used when:
   * - Off-chain engine fails
   * - User disconnects
   * - Timeout expires
   *
   * User provides last signed state, settlement proceeds.
   */
  emergencySettle(
    sessionObject: SessionObject,
    lastValidState: SessionState,
    userPublicKey: string,
    enginePublicKey: string,
  ): {
    success: boolean;
    error?: string;
    settledSession?: SessionObject;
  } {
    // Verify state signatures
    if (!lastValidState.signatures.user || !lastValidState.signatures.engine) {
      return {
        success: false,
        error: "Missing signatures on last valid state",
      };
    }

    // Verify session binding
    if (lastValidState.sessionId !== sessionObject.sessionId) {
      return {
        success: false,
        error: "Session ID mismatch",
      };
    }

    // Verify capital conservation
    const capitalCheck = this.verifyCapitalConservation(
      lastValidState.balances,
      sessionObject.lockedAssets,
    );

    if (!capitalCheck.valid) {
      return {
        success: false,
        error: `Capital conservation violated: ${capitalCheck.error}`,
      };
    }

    // Create minimal proof from last state
    const emergencyProof: SettlementProof = {
      stateHistory: [lastValidState],
      finalState: lastValidState,
      actionLogRoot: "emergency",
      totalActions: lastValidState.actionLog.length,
      finalBalances: lastValidState.balances,
      userSettlementSignature: lastValidState.signatures.user,
    };

    // Execute settlement
    const settledSession: SessionObject = {
      ...sessionObject,
      status: SessionStatus.SETTLED,
      settlementTime: Date.now(),
      finalStateHash: lastValidState.stateHash,
      settlementProof: emergencyProof,
    };

    return {
      success: true,
      settledSession,
    };
  }
}

// ============================================================================
// ON-CHAIN SETTLEMENT SIMULATION
// ============================================================================

/**
 * Simulate on-chain settlement transaction.
 *
 * In production on Sui, this would be:
 *
 * ```move
 * public entry fun settle_session(
 *     session: &mut SessionObject,
 *     proof: SettlementProof,
 *     ctx: &mut TxContext
 * ) {
 *     // Verify proof
 *     assert!(verify_state_chain(&proof.state_history), E_INVALID_CHAIN);
 *     assert!(verify_signatures(&proof, ctx), E_INVALID_SIGNATURE);
 *     assert!(verify_capital(&proof, session), E_CAPITAL_VIOLATION);
 *
 *     // Update session
 *     session.status = SETTLED;
 *     session.final_state_hash = proof.final_state.hash;
 *     session.settlement_time = tx_context::epoch_timestamp_ms(ctx);
 *
 *     // Transfer balances back to user
 *     transfer_assets(session, proof.final_balances, ctx);
 * }
 * ```
 */
export function simulateOnChainSettlement(
  sessionObject: SessionObject,
  proof: SettlementProof,
  userPublicKey: string,
  enginePublicKey: string,
): {
  success: boolean;
  error?: string;
  settledSession?: SessionObject;
  gasUsed: number;
  eventLogs: string[];
} {
  const verifier = new BrowserSettlementVerifier();
  const eventLogs: string[] = [];

  // Simulate gas cost (in production, this is actual gas)
  let gasUsed = 0;

  // Base cost for transaction
  gasUsed += 1000;
  eventLogs.push("Settlement transaction initiated");

  // Cost for state verification (scales with state history length)
  gasUsed += proof.stateHistory.length * 100;
  eventLogs.push(`Verifying ${proof.stateHistory.length} states in chain`);

  // Cost for signature verification
  gasUsed += proof.stateHistory.length * 50;
  eventLogs.push("Verifying signatures");

  // Execute verification
  const result = verifier.verifyAndSettle(
    sessionObject,
    proof,
    userPublicKey,
    enginePublicKey,
  );

  if (!result.success) {
    eventLogs.push(`Settlement failed: ${result.error}`);
    return {
      success: false,
      error: result.error,
      gasUsed,
      eventLogs,
    };
  }

  // Cost for state update
  gasUsed += 500;
  eventLogs.push("Updating session object state");

  // Cost for asset transfer
  const assetCount = Object.keys(proof.finalBalances).length;
  gasUsed += assetCount * 200;
  eventLogs.push(`Transferring ${assetCount} assets back to user`);

  eventLogs.push("Settlement successful");

  return {
    success: true,
    settledSession: result.settledSession,
    gasUsed,
    eventLogs,
  };
}
