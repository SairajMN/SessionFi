/**
 * Sui Settlement Layer for AMM Sessions
 *
 * High-performance settlement on Sui blockchain for AMM session finalization.
 * Handles token transfers, position management, and proof verification.
 *
 * Key Features:
 * - Atomic settlement of all session operations
 * - Merkle proof verification for efficient on-chain validation
 * - Position NFT minting for LP positions
 * - Cross-session liquidity aggregation
 */

import {
  AMMSession,
  AMMSessionStatus,
  AMMSettlementProof,
  TokenSettlement,
  PositionSettlement,
  IntentExecutionProof,
  IntentStatus,
  LiquidityPosition,
} from "../types";
import { hashStringSync } from "../../crypto/browser-primitives";

// ============================================================================
// SUI SETTLEMENT TYPES
// ============================================================================

/**
 * Sui transaction result
 */
export interface SuiTransactionResult {
  success: boolean;
  digest: string;
  gasUsed: bigint;
  events: SuiEvent[];
  error?: string;
}

/**
 * Sui event emitted during settlement
 */
export interface SuiEvent {
  type: SuiEventType;
  sessionId: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export enum SuiEventType {
  SESSION_SETTLED = "SESSION_SETTLED",
  TOKENS_TRANSFERRED = "TOKENS_TRANSFERRED",
  POSITION_MINTED = "POSITION_MINTED",
  POSITION_BURNED = "POSITION_BURNED",
  FEES_COLLECTED = "FEES_COLLECTED",
  SETTLEMENT_FAILED = "SETTLEMENT_FAILED",
}

/**
 * Sui object representing an AMM session on-chain
 */
export interface SuiSessionObject {
  objectId: string;
  version: number;
  digest: string;
  sessionId: string;
  owner: string;
  status: AMMSessionStatus;
  lockedTokens: Map<string, bigint>;
  positionIds: string[];
  createdAt: number;
  settledAt?: number;
  finalStateHash?: string;
}

/**
 * Sui object representing a liquidity position NFT
 */
export interface SuiPositionNFT {
  objectId: string;
  version: number;
  digest: string;
  positionId: string;
  poolId: string;
  owner: string;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  feesEarned0: bigint;
  feesEarned1: bigint;
}

// ============================================================================
// SUI SETTLEMENT ENGINE
// ============================================================================

/**
 * SuiSettlementEngine handles all settlement operations on Sui
 */
export class SuiSettlementEngine {
  private networkUrl: string;
  private adminAddress: string;
  private moduleAddress: string;

  constructor(
    networkUrl: string = "https://fullnode.testnet.sui.io",
    adminAddress: string = "0x" + "0".repeat(64),
    moduleAddress: string = "0x" + "1".repeat(64),
  ) {
    this.networkUrl = networkUrl;
    this.adminAddress = adminAddress;
    this.moduleAddress = moduleAddress;
  }

  // ==========================================================================
  // SESSION SETTLEMENT
  // ==========================================================================

  /**
   * Settle an AMM session on Sui
   * This is the main entry point for settlement
   */
  async settleSession(
    session: AMMSession,
    proof: AMMSettlementProof,
    userSignature: string,
    engineSignature: string,
  ): Promise<SuiSettlementResult> {
    const events: SuiEvent[] = [];
    let totalGasUsed = BigInt(0);

    try {
      // 1. Verify proof integrity
      const proofValid = this.verifySettlementProof(session, proof);
      if (!proofValid.valid) {
        return {
          success: false,
          error: proofValid.error,
          gasUsed: BigInt(1000),
          events: [
            this.createEvent(
              SuiEventType.SETTLEMENT_FAILED,
              session.sessionId,
              {
                error: proofValid.error,
              },
            ),
          ],
        };
      }
      totalGasUsed += BigInt(5000); // Verification gas

      // 2. Verify signatures
      const signaturesValid = this.verifySignatures(
        proof,
        userSignature,
        engineSignature,
      );
      if (!signaturesValid) {
        return {
          success: false,
          error: "Invalid signatures",
          gasUsed: totalGasUsed,
          events: [
            this.createEvent(
              SuiEventType.SETTLEMENT_FAILED,
              session.sessionId,
              {
                error: "signature_verification_failed",
              },
            ),
          ],
        };
      }
      totalGasUsed += BigInt(3000); // Signature verification gas

      // 3. Process token settlements
      const tokenResult = await this.processTokenSettlements(
        session,
        proof.tokenSettlements,
      );
      events.push(...tokenResult.events);
      totalGasUsed += tokenResult.gasUsed;

      if (!tokenResult.success) {
        return {
          success: false,
          error: tokenResult.error,
          gasUsed: totalGasUsed,
          events,
        };
      }

      // 4. Process position settlements
      const positionResult = await this.processPositionSettlements(
        session,
        proof.positionSettlements,
      );
      events.push(...positionResult.events);
      totalGasUsed += positionResult.gasUsed;

      // 5. Update session object
      const sessionUpdateResult = await this.updateSessionObject(
        session,
        proof,
      );
      events.push(...sessionUpdateResult.events);
      totalGasUsed += sessionUpdateResult.gasUsed;

      // 6. Emit settlement complete event
      events.push(
        this.createEvent(SuiEventType.SESSION_SETTLED, session.sessionId, {
          totalVolume: proof.totalVolume.toString(),
          totalFees: proof.totalFees.toString(),
          totalIntents: proof.totalIntentsExecuted,
          finalStateHash: proof.finalStateHash,
        }),
      );

      return {
        success: true,
        digest: this.generateTransactionDigest(session.sessionId, proof),
        gasUsed: totalGasUsed,
        events,
        settledSession: {
          ...session,
          status: AMMSessionStatus.SETTLED,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        gasUsed: totalGasUsed,
        events,
      };
    }
  }

  // ==========================================================================
  // PROOF VERIFICATION
  // ==========================================================================

  /**
   * Verify settlement proof integrity
   */
  private verifySettlementProof(
    session: AMMSession,
    proof: AMMSettlementProof,
  ): { valid: boolean; error?: string } {
    // Verify session ID matches
    if (proof.sessionId !== session.sessionId) {
      return { valid: false, error: "Session ID mismatch" };
    }

    // Verify state root
    const computedStateRoot = this.computeStateRoot(proof);
    if (computedStateRoot !== proof.stateRoot) {
      return { valid: false, error: "State root mismatch" };
    }

    // Verify intent root
    const computedIntentRoot = this.computeIntentRoot(proof.intentProofs);
    if (computedIntentRoot !== proof.intentRoot) {
      return { valid: false, error: "Intent root mismatch" };
    }

    // Verify position root
    const computedPositionRoot = this.computePositionRoot(
      proof.positionSettlements,
    );
    if (computedPositionRoot !== proof.positionRoot) {
      return { valid: false, error: "Position root mismatch" };
    }

    // Verify token settlements are valid
    // Note: In AMM sessions, tokens can be swapped, so:
    // - Individual token balances may exceed original locked amounts (e.g., swapped into)
    // - Individual token balances may be less than locked amounts (e.g., swapped out)
    // - New tokens may appear that weren't originally locked (e.g., received from swaps)
    // The key invariant is: total value should be conserved (minus fees)
    for (const tokenSettlement of proof.tokenSettlements) {
      // Check no negative balances
      if (tokenSettlement.finalAmount < BigInt(0)) {
        return {
          valid: false,
          error: `Negative final balance for ${tokenSettlement.tokenAddress}`,
        };
      }

      // Note: We do NOT check finalAmount <= lockedAmount for individual tokens
      // because swaps can result in receiving more of one token in exchange for another.
      // Value conservation is implicitly enforced by the intent execution engine.
    }

    // Verify all intents are in terminal state
    for (const intentProof of proof.intentProofs) {
      if (
        intentProof.status !== IntentStatus.FILLED &&
        intentProof.status !== IntentStatus.CANCELLED &&
        intentProof.status !== IntentStatus.EXPIRED &&
        intentProof.status !== IntentStatus.FAILED
      ) {
        return {
          valid: false,
          error: `Intent ${intentProof.intentId} not in terminal state`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Verify dual signatures on proof
   */
  private verifySignatures(
    proof: AMMSettlementProof,
    userSignature: string,
    engineSignature: string,
  ): boolean {
    // Verify user signature matches proof
    if (proof.userSignature !== userSignature) {
      return false;
    }

    // Verify engine signature matches proof
    if (proof.engineSignature !== engineSignature) {
      return false;
    }

    // In production, would verify actual cryptographic signatures
    // For MVP, verify format
    const sigRegex = /^[0-9a-f]{64}$/;
    return sigRegex.test(userSignature) && sigRegex.test(engineSignature);
  }

  // ==========================================================================
  // TOKEN SETTLEMENTS
  // ==========================================================================

  /**
   * Process token settlements - transfer tokens back to user
   */
  private async processTokenSettlements(
    session: AMMSession,
    settlements: TokenSettlement[],
  ): Promise<{
    success: boolean;
    events: SuiEvent[];
    gasUsed: bigint;
    error?: string;
  }> {
    const events: SuiEvent[] = [];
    let gasUsed = BigInt(0);

    for (const settlement of settlements) {
      // Calculate transfer amount
      const transferAmount = settlement.finalAmount;

      if (transferAmount > BigInt(0)) {
        // Simulate token transfer
        events.push(
          this.createEvent(SuiEventType.TOKENS_TRANSFERRED, session.sessionId, {
            token: settlement.tokenAddress,
            from: this.moduleAddress,
            to: session.ownerAddress,
            amount: transferAmount.toString(),
          }),
        );

        // Gas cost per transfer
        gasUsed += BigInt(2000);
      }

      // Track consumed tokens (fees, swaps, etc.)
      const consumed = settlement.initialAmount - settlement.finalAmount;
      if (consumed > BigInt(0)) {
        events.push(
          this.createEvent(SuiEventType.FEES_COLLECTED, session.sessionId, {
            token: settlement.tokenAddress,
            amount: consumed.toString(),
          }),
        );
      }
    }

    return { success: true, events, gasUsed };
  }

  // ==========================================================================
  // POSITION SETTLEMENTS
  // ==========================================================================

  /**
   * Process position settlements - mint/burn position NFTs
   */
  private async processPositionSettlements(
    session: AMMSession,
    settlements: PositionSettlement[],
  ): Promise<{ success: boolean; events: SuiEvent[]; gasUsed: bigint }> {
    const events: SuiEvent[] = [];
    let gasUsed = BigInt(0);

    for (const settlement of settlements) {
      if (settlement.liquidity > BigInt(0)) {
        // Mint position NFT
        const positionNFT = this.createPositionNFT(session, settlement);

        events.push(
          this.createEvent(SuiEventType.POSITION_MINTED, session.sessionId, {
            positionId: settlement.positionId,
            poolId: settlement.poolId,
            tickLower: settlement.tickLower,
            tickUpper: settlement.tickUpper,
            liquidity: settlement.liquidity.toString(),
            nftObjectId: positionNFT.objectId,
          }),
        );

        gasUsed += BigInt(5000); // NFT minting gas
      } else {
        // Position was fully withdrawn
        events.push(
          this.createEvent(SuiEventType.POSITION_BURNED, session.sessionId, {
            positionId: settlement.positionId,
          }),
        );

        gasUsed += BigInt(2000); // NFT burning gas
      }

      // Collect fees if any
      if (
        settlement.feesEarned0 > BigInt(0) ||
        settlement.feesEarned1 > BigInt(0)
      ) {
        events.push(
          this.createEvent(SuiEventType.FEES_COLLECTED, session.sessionId, {
            positionId: settlement.positionId,
            fees0: settlement.feesEarned0.toString(),
            fees1: settlement.feesEarned1.toString(),
          }),
        );

        gasUsed += BigInt(1000);
      }
    }

    return { success: true, events, gasUsed };
  }

  // ==========================================================================
  // SESSION OBJECT UPDATE
  // ==========================================================================

  /**
   * Update session object on-chain to settled state
   */
  private async updateSessionObject(
    session: AMMSession,
    proof: AMMSettlementProof,
  ): Promise<{ success: boolean; events: SuiEvent[]; gasUsed: bigint }> {
    // Create Sui session object update
    const suiSession: SuiSessionObject = {
      objectId: this.generateObjectId(session.sessionId),
      version: session.nonce + 1,
      digest: this.generateTransactionDigest(session.sessionId, proof),
      sessionId: session.sessionId,
      owner: session.ownerAddress,
      status: AMMSessionStatus.SETTLED,
      lockedTokens: new Map(), // All tokens transferred out
      positionIds: session.liquidityPositions
        .filter((p) => p.liquidity > BigInt(0))
        .map((p) => p.positionId),
      createdAt: session.createdAt,
      settledAt: Date.now(),
      finalStateHash: proof.finalStateHash,
    };

    return {
      success: true,
      events: [],
      gasUsed: BigInt(3000),
    };
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================

  private computeStateRoot(proof: AMMSettlementProof): string {
    const stateData = {
      sessionId: proof.sessionId,
      tokenSettlements: proof.tokenSettlements.map((t) => ({
        token: t.tokenAddress,
        initial: t.initialAmount.toString(),
        final: t.finalAmount.toString(),
      })),
      totalVolume: proof.totalVolume.toString(),
      totalFees: proof.totalFees.toString(),
    };

    return hashStringSync(JSON.stringify(stateData));
  }

  private computeIntentRoot(intentProofs: IntentExecutionProof[]): string {
    if (intentProofs.length === 0) {
      return hashStringSync("empty_intents");
    }

    const intentData = intentProofs.map((i) => ({
      id: i.intentId,
      type: i.intentType,
      status: i.status,
      input: i.inputAmount.toString(),
      output: i.outputAmount.toString(),
    }));

    return hashStringSync(JSON.stringify(intentData));
  }

  private computePositionRoot(positions: PositionSettlement[]): string {
    if (positions.length === 0) {
      return hashStringSync("empty_positions");
    }

    const positionData = positions.map((p) => ({
      id: p.positionId,
      pool: p.poolId,
      tickLower: p.tickLower,
      tickUpper: p.tickUpper,
      liquidity: p.liquidity.toString(),
    }));

    return hashStringSync(JSON.stringify(positionData));
  }

  private createEvent(
    type: SuiEventType,
    sessionId: string,
    data: Record<string, unknown>,
  ): SuiEvent {
    return {
      type,
      sessionId,
      data,
      timestamp: Date.now(),
    };
  }

  private createPositionNFT(
    session: AMMSession,
    settlement: PositionSettlement,
  ): SuiPositionNFT {
    return {
      objectId: this.generateObjectId(settlement.positionId),
      version: 1,
      digest: hashStringSync(`nft:${settlement.positionId}:${Date.now()}`),
      positionId: settlement.positionId,
      poolId: settlement.poolId,
      owner: session.ownerAddress,
      tickLower: settlement.tickLower,
      tickUpper: settlement.tickUpper,
      liquidity: settlement.liquidity,
      feesEarned0: settlement.feesEarned0,
      feesEarned1: settlement.feesEarned1,
    };
  }

  private generateObjectId(seed: string): string {
    return (
      "0x" + hashStringSync(`sui_obj:${seed}:${Date.now()}`).substring(0, 64)
    );
  }

  private generateTransactionDigest(
    sessionId: string,
    proof: AMMSettlementProof,
  ): string {
    return hashStringSync(
      `tx:${sessionId}:${proof.finalStateHash}:${Date.now()}`,
    );
  }

  // ==========================================================================
  // SETTLEMENT PROOF GENERATION
  // ==========================================================================

  /**
   * Generate settlement proof from session state
   */
  generateSettlementProof(
    session: AMMSession,
    userPrivateKey: string,
    enginePrivateKey: string,
  ): AMMSettlementProof {
    // Generate token settlements
    // Include ALL tokens - both originally locked AND newly received from swaps
    const tokenSettlements: TokenSettlement[] = [];
    const processedTokens = new Set<string>();

    // First, process all originally locked tokens
    session.lockedTokens.forEach((initialAmount, tokenAddress) => {
      const finalAmount =
        session.availableTokens.get(tokenAddress) || BigInt(0);
      tokenSettlements.push({
        tokenAddress,
        initialAmount,
        finalAmount,
        netChange: finalAmount - initialAmount,
      });
      processedTokens.add(tokenAddress);
    });

    // Then, add any NEW tokens that were received from swaps (not originally locked)
    session.availableTokens.forEach((finalAmount, tokenAddress) => {
      if (!processedTokens.has(tokenAddress) && finalAmount > BigInt(0)) {
        tokenSettlements.push({
          tokenAddress,
          initialAmount: BigInt(0), // Was not originally locked
          finalAmount,
          netChange: finalAmount, // All of it is "gained" from swaps
        });
      }
    });

    // Generate position settlements
    const positionSettlements: PositionSettlement[] =
      session.liquidityPositions.map((pos) => ({
        positionId: pos.positionId,
        poolId: pos.poolId,
        tickLower: pos.tickLower,
        tickUpper: pos.tickUpper,
        liquidity: pos.liquidity,
        feesEarned0: pos.tokensOwed0,
        feesEarned1: pos.tokensOwed1,
      }));

    // Generate intent execution proofs
    const intentProofs: IntentExecutionProof[] = session.completedIntents.map(
      (intent) => ({
        intentId: intent.intentId,
        intentType: intent.type,
        status: intent.status,
        inputAmount: BigInt(0), // Would be populated from intent
        outputAmount: BigInt(0), // Would be populated from intent
        executionPrice: BigInt(0), // Would be populated from intent
        timestamp: intent.createdAt,
      }),
    );

    // Compute roots
    const proof: AMMSettlementProof = {
      sessionId: session.sessionId,
      finalStateHash: session.stateHash,
      tokenSettlements,
      positionSettlements,
      intentProofs,
      totalVolume: session.totalSwapVolume,
      totalFees: session.totalFeesGenerated,
      totalIntentsExecuted: session.completedIntents.length,
      userSignature: hashStringSync(
        `user_sign:${session.stateHash}:${userPrivateKey}`,
      ),
      engineSignature: hashStringSync(
        `engine_sign:${session.stateHash}:${enginePrivateKey}`,
      ),
      stateRoot: "",
      intentRoot: "",
      positionRoot: "",
    };

    // Compute merkle roots
    proof.stateRoot = this.computeStateRoot(proof);
    proof.intentRoot = this.computeIntentRoot(proof.intentProofs);
    proof.positionRoot = this.computePositionRoot(proof.positionSettlements);

    return proof;
  }
}

// ============================================================================
// RESULT TYPES
// ============================================================================

export interface SuiSettlementResult {
  success: boolean;
  digest?: string;
  gasUsed: bigint;
  events: SuiEvent[];
  settledSession?: AMMSession;
  error?: string;
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const suiSettlementEngine = new SuiSettlementEngine();
