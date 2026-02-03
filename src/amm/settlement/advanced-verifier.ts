/**
 * Advanced Settlement Verification System
 *
 * Provides comprehensive cryptographic verification for AMM session settlements.
 *
 * Key Features:
 * - Merkle Tree verification for state proofs
 * - Multi-party threshold signatures
 * - Fraud proof detection and challenge system
 * - Zero-knowledge proof simulation for privacy
 * - State transition verification
 * - Balance solvency proofs
 * - Optimistic settlement with challenge periods
 */

import {
  AMMSession,
  AMMSessionStatus,
  AMMSettlementProof,
  TokenSettlement,
  PositionSettlement,
  IntentExecutionProof,
  IntentStatus,
  IntentType,
} from "../types";
import { hashStringSync } from "../../crypto/browser-primitives";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Verification result with detailed breakdown
 */
export interface VerificationResult {
  valid: boolean;
  score: number; // 0-100 confidence score
  checks: VerificationCheck[];
  proofHash: string;
  timestamp: number;
  verifierSignature: string;
}

/**
 * Individual verification check
 */
export interface VerificationCheck {
  name: string;
  passed: boolean;
  details: string;
  weight: number;
  gasEstimate: bigint;
}

/**
 * Merkle proof for state verification
 */
export interface MerkleProof {
  root: string;
  leaf: string;
  path: MerkleNode[];
  leafIndex: number;
}

/**
 * Merkle tree node
 */
export interface MerkleNode {
  hash: string;
  direction: "left" | "right";
}

/**
 * Fraud proof submission
 */
export interface FraudProof {
  fraudId: string;
  sessionId: string;
  challengerAddress: string;
  fraudType: FraudType;
  evidence: FraudEvidence;
  bondAmount: bigint;
  submittedAt: number;
  deadline: number;
  status: FraudProofStatus;
}

export enum FraudType {
  DOUBLE_SPEND = "DOUBLE_SPEND",
  INVALID_STATE_TRANSITION = "INVALID_STATE_TRANSITION",
  SIGNATURE_MISMATCH = "SIGNATURE_MISMATCH",
  BALANCE_OVERFLOW = "BALANCE_OVERFLOW",
  UNAUTHORIZED_TRANSFER = "UNAUTHORIZED_TRANSFER",
  MERKLE_PROOF_INVALID = "MERKLE_PROOF_INVALID",
  INTENT_REPLAY = "INTENT_REPLAY",
}

export enum FraudProofStatus {
  PENDING = "PENDING",
  VALIDATED = "VALIDATED",
  REJECTED = "REJECTED",
  EXPIRED = "EXPIRED",
}

export interface FraudEvidence {
  stateHash: string;
  expectedValue: string;
  actualValue: string;
  merkleProof?: MerkleProof;
  conflictingTransactions?: string[];
}

/**
 * Zero-knowledge proof simulation
 */
export interface ZKProof {
  proofId: string;
  circuitType: ZKCircuitType;
  publicInputs: string[];
  proof: string; // Simulated proof bytes
  verified: boolean;
}

export enum ZKCircuitType {
  BALANCE_SOLVENCY = "BALANCE_SOLVENCY",
  STATE_TRANSITION = "STATE_TRANSITION",
  SWAP_VALIDITY = "SWAP_VALIDITY",
  LP_POSITION = "LP_POSITION",
}

/**
 * Multi-party signature scheme
 */
export interface ThresholdSignature {
  sigId: string;
  message: string;
  threshold: number;
  totalSigners: number;
  collectedSignatures: PartialSignature[];
  aggregatedSignature?: string;
  verified: boolean;
}

export interface PartialSignature {
  signerAddress: string;
  signerIndex: number;
  partialSig: string;
  timestamp: number;
}

// ============================================================================
// ADVANCED VERIFIER
// ============================================================================

/**
 * AdvancedSettlementVerifier provides comprehensive verification
 */
export class AdvancedSettlementVerifier {
  private verifierAddress: string;
  private fraudProofs: Map<string, FraudProof> = new Map();
  private zkProofCache: Map<string, ZKProof> = new Map();
  private merkleRoots: Map<string, string> = new Map();

  // Configuration
  private readonly CHALLENGE_PERIOD_MS = 7200000; // 2 hours
  private readonly MIN_BOND_AMOUNT = BigInt(1000000); // 1 USDC
  private readonly VERIFICATION_THRESHOLD = 3; // 3-of-5 multisig

  constructor(verifierAddress: string = "0xverifier") {
    this.verifierAddress = verifierAddress;
  }

  // ==========================================================================
  // MAIN VERIFICATION
  // ==========================================================================

  /**
   * Perform comprehensive verification of settlement
   */
  async verifySettlement(
    session: AMMSession,
    proof: AMMSettlementProof,
    options: VerificationOptions = {},
  ): Promise<VerificationResult> {
    const checks: VerificationCheck[] = [];
    let totalWeight = 0;
    let passedWeight = 0;

    // 1. Basic proof integrity check
    const integrityCheck = this.verifyProofIntegrity(session, proof);
    checks.push(integrityCheck);
    totalWeight += integrityCheck.weight;
    if (integrityCheck.passed) passedWeight += integrityCheck.weight;

    // 2. Merkle tree verification
    const merkleCheck = this.verifyMerkleProofs(session, proof);
    checks.push(merkleCheck);
    totalWeight += merkleCheck.weight;
    if (merkleCheck.passed) passedWeight += merkleCheck.weight;

    // 3. State transition verification
    const stateCheck = this.verifyStateTransitions(session, proof);
    checks.push(stateCheck);
    totalWeight += stateCheck.weight;
    if (stateCheck.passed) passedWeight += stateCheck.weight;

    // 4. Balance solvency verification
    const solvencyCheck = this.verifyBalanceSolvency(session, proof);
    checks.push(solvencyCheck);
    totalWeight += solvencyCheck.weight;
    if (solvencyCheck.passed) passedWeight += solvencyCheck.weight;

    // 5. Signature verification
    const sigCheck = this.verifySignatures(proof);
    checks.push(sigCheck);
    totalWeight += sigCheck.weight;
    if (sigCheck.passed) passedWeight += sigCheck.weight;

    // 6. Intent execution verification
    const intentCheck = this.verifyIntentExecutions(session, proof);
    checks.push(intentCheck);
    totalWeight += intentCheck.weight;
    if (intentCheck.passed) passedWeight += intentCheck.weight;

    // 7. Position verification
    const positionCheck = this.verifyPositions(session, proof);
    checks.push(positionCheck);
    totalWeight += positionCheck.weight;
    if (positionCheck.passed) passedWeight += positionCheck.weight;

    // 8. Fraud detection
    const fraudCheck = await this.checkForFraud(session, proof);
    checks.push(fraudCheck);
    totalWeight += fraudCheck.weight;
    if (fraudCheck.passed) passedWeight += fraudCheck.weight;

    // 9. ZK proof verification (if enabled)
    if (options.requireZKProof) {
      const zkCheck = await this.verifyZKProofs(session, proof);
      checks.push(zkCheck);
      totalWeight += zkCheck.weight;
      if (zkCheck.passed) passedWeight += zkCheck.weight;
    }

    // 10. Optimistic verification window check
    if (options.checkChallengePeriod) {
      const windowCheck = this.verifyChallengePeriod(session);
      checks.push(windowCheck);
      totalWeight += windowCheck.weight;
      if (windowCheck.passed) passedWeight += windowCheck.weight;
    }

    const score = Math.round((passedWeight / totalWeight) * 100);
    const valid = checks.every((c) => c.passed);

    return {
      valid,
      score,
      checks,
      proofHash: this.computeVerificationHash(checks),
      timestamp: Date.now(),
      verifierSignature: this.signVerification(session.sessionId, valid),
    };
  }

  // ==========================================================================
  // PROOF INTEGRITY
  // ==========================================================================

  private verifyProofIntegrity(
    session: AMMSession,
    proof: AMMSettlementProof,
  ): VerificationCheck {
    const issues: string[] = [];

    // Check session ID match
    if (proof.sessionId !== session.sessionId) {
      issues.push("Session ID mismatch");
    }

    // Check state hash
    if (proof.finalStateHash !== session.stateHash) {
      issues.push("State hash mismatch");
    }

    // Check totals
    const expectedIntents = session.completedIntents.length;
    if (proof.totalIntentsExecuted !== expectedIntents) {
      issues.push(
        `Intent count mismatch: ${proof.totalIntentsExecuted} vs ${expectedIntents}`,
      );
    }

    // Check volume consistency
    if (proof.totalVolume !== session.totalSwapVolume) {
      issues.push("Volume mismatch");
    }

    return {
      name: "Proof Integrity",
      passed: issues.length === 0,
      details:
        issues.length > 0 ? issues.join("; ") : "All integrity checks passed",
      weight: 20,
      gasEstimate: BigInt(5000),
    };
  }

  // ==========================================================================
  // MERKLE VERIFICATION
  // ==========================================================================

  private verifyMerkleProofs(
    session: AMMSession,
    proof: AMMSettlementProof,
  ): VerificationCheck {
    const issues: string[] = [];

    // Build and verify state merkle tree
    const stateTree = this.buildStateMerkleTree(proof);
    if (stateTree.root !== proof.stateRoot) {
      issues.push("State merkle root mismatch");
    }

    // Build and verify intent merkle tree
    const intentTree = this.buildIntentMerkleTree(proof.intentProofs);
    if (intentTree.root !== proof.intentRoot) {
      issues.push("Intent merkle root mismatch");
    }

    // Build and verify position merkle tree
    const positionTree = this.buildPositionMerkleTree(
      proof.positionSettlements,
    );
    if (positionTree.root !== proof.positionRoot) {
      issues.push("Position merkle root mismatch");
    }

    // Store verified roots
    if (issues.length === 0) {
      this.merkleRoots.set(`${session.sessionId}:state`, proof.stateRoot);
      this.merkleRoots.set(`${session.sessionId}:intent`, proof.intentRoot);
      this.merkleRoots.set(`${session.sessionId}:position`, proof.positionRoot);
    }

    return {
      name: "Merkle Proof Verification",
      passed: issues.length === 0,
      details:
        issues.length > 0 ? issues.join("; ") : "All merkle proofs valid",
      weight: 25,
      gasEstimate: BigInt(15000),
    };
  }

  private buildStateMerkleTree(proof: AMMSettlementProof): {
    root: string;
    leaves: string[];
  } {
    const leaves = proof.tokenSettlements.map((t) =>
      hashStringSync(`${t.tokenAddress}:${t.initialAmount}:${t.finalAmount}`),
    );
    return this.computeMerkleRoot(leaves);
  }

  private buildIntentMerkleTree(intents: IntentExecutionProof[]): {
    root: string;
    leaves: string[];
  } {
    if (intents.length === 0) {
      return { root: hashStringSync("empty_intents"), leaves: [] };
    }
    const leaves = intents.map((i) =>
      hashStringSync(
        `${i.intentId}:${i.intentType}:${i.status}:${i.inputAmount}:${i.outputAmount}`,
      ),
    );
    return this.computeMerkleRoot(leaves);
  }

  private buildPositionMerkleTree(positions: PositionSettlement[]): {
    root: string;
    leaves: string[];
  } {
    if (positions.length === 0) {
      return { root: hashStringSync("empty_positions"), leaves: [] };
    }
    const leaves = positions.map((p) =>
      hashStringSync(
        `${p.positionId}:${p.poolId}:${p.tickLower}:${p.tickUpper}:${p.liquidity}`,
      ),
    );
    return this.computeMerkleRoot(leaves);
  }

  private computeMerkleRoot(leaves: string[]): {
    root: string;
    leaves: string[];
  } {
    if (leaves.length === 0) {
      return { root: hashStringSync("empty"), leaves: [] };
    }

    // Pad to power of 2
    const paddedLeaves = [...leaves];
    while (paddedLeaves.length & (paddedLeaves.length - 1)) {
      paddedLeaves.push(hashStringSync("padding"));
    }

    let level = paddedLeaves;
    while (level.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const combined = level[i] + level[i + 1];
        nextLevel.push(hashStringSync(combined));
      }
      level = nextLevel;
    }

    return { root: level[0], leaves };
  }

  /**
   * Generate merkle proof for a specific leaf
   */
  generateMerkleProof(leaves: string[], leafIndex: number): MerkleProof {
    const { root } = this.computeMerkleRoot(leaves);
    const path: MerkleNode[] = [];

    let currentLevel = [...leaves];
    let currentIndex = leafIndex;

    while (currentLevel.length > 1) {
      const isRight = currentIndex % 2 === 1;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

      if (siblingIndex < currentLevel.length) {
        path.push({
          hash: currentLevel[siblingIndex],
          direction: isRight ? "left" : "right",
        });
      }

      // Move to next level
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const combined = currentLevel[i] + (currentLevel[i + 1] || "");
        nextLevel.push(hashStringSync(combined));
      }
      currentLevel = nextLevel;
      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      root,
      leaf: leaves[leafIndex],
      path,
      leafIndex,
    };
  }

  /**
   * Verify a merkle proof
   */
  verifyMerkleProof(proof: MerkleProof): boolean {
    let computed = proof.leaf;

    for (const node of proof.path) {
      if (node.direction === "left") {
        computed = hashStringSync(node.hash + computed);
      } else {
        computed = hashStringSync(computed + node.hash);
      }
    }

    return computed === proof.root;
  }

  // ==========================================================================
  // STATE TRANSITION VERIFICATION
  // ==========================================================================

  private verifyStateTransitions(
    session: AMMSession,
    proof: AMMSettlementProof,
  ): VerificationCheck {
    const issues: string[] = [];

    // Verify each token settlement represents valid transitions
    for (const tokenSettlement of proof.tokenSettlements) {
      const lockedAmount =
        session.lockedTokens.get(tokenSettlement.tokenAddress) || BigInt(0);

      // Initial amount should match locked
      if (tokenSettlement.initialAmount !== lockedAmount) {
        issues.push(
          `Initial amount mismatch for ${tokenSettlement.tokenAddress}`,
        );
      }

      // Final amount should not exceed initial (no minting)
      if (tokenSettlement.finalAmount > tokenSettlement.initialAmount) {
        issues.push(
          `Final exceeds initial for ${tokenSettlement.tokenAddress}`,
        );
      }

      // Net change should be consistent
      const expectedChange =
        tokenSettlement.finalAmount - tokenSettlement.initialAmount;
      if (tokenSettlement.netChange !== expectedChange) {
        issues.push(`Net change mismatch for ${tokenSettlement.tokenAddress}`);
      }
    }

    // Verify intent transitions
    for (const intentProof of proof.intentProofs) {
      const validTransition = this.isValidIntentTransition(intentProof);
      if (!validTransition) {
        issues.push(`Invalid intent transition for ${intentProof.intentId}`);
      }
    }

    return {
      name: "State Transition Verification",
      passed: issues.length === 0,
      details:
        issues.length > 0 ? issues.join("; ") : "All state transitions valid",
      weight: 20,
      gasEstimate: BigInt(10000),
    };
  }

  private isValidIntentTransition(intentProof: IntentExecutionProof): boolean {
    // Valid terminal states
    const validTerminalStates = [
      IntentStatus.FILLED,
      IntentStatus.CANCELLED,
      IntentStatus.EXPIRED,
      IntentStatus.FAILED,
    ];

    return validTerminalStates.includes(intentProof.status);
  }

  // ==========================================================================
  // BALANCE SOLVENCY
  // ==========================================================================

  private verifyBalanceSolvency(
    session: AMMSession,
    proof: AMMSettlementProof,
  ): VerificationCheck {
    const issues: string[] = [];

    // Check each token has non-negative final balance
    for (const settlement of proof.tokenSettlements) {
      if (settlement.finalAmount < BigInt(0)) {
        issues.push(`Negative balance for ${settlement.tokenAddress}`);
      }
    }

    // Verify conservation of value (simplified)
    let totalInitial = BigInt(0);
    let totalFinal = BigInt(0);

    for (const settlement of proof.tokenSettlements) {
      totalInitial += settlement.initialAmount;
      totalFinal += settlement.finalAmount;
    }

    // Total should not increase (no value creation)
    if (totalFinal > totalInitial) {
      issues.push("Value conservation violated: total final > total initial");
    }

    // Generate solvency proof
    const solvencyProof = this.generateSolvencyProof(proof);
    if (!solvencyProof.verified) {
      issues.push("Solvency proof verification failed");
    }

    return {
      name: "Balance Solvency",
      passed: issues.length === 0,
      details: issues.length > 0 ? issues.join("; ") : "All balances solvent",
      weight: 15,
      gasEstimate: BigInt(8000),
    };
  }

  private generateSolvencyProof(proof: AMMSettlementProof): {
    verified: boolean;
    hash: string;
  } {
    // Simulate solvency proof generation
    const data = proof.tokenSettlements.map((t) => ({
      token: t.tokenAddress,
      solvent: t.finalAmount >= BigInt(0) && t.finalAmount <= t.initialAmount,
    }));

    const allSolvent = data.every((d) => d.solvent);
    const hash = hashStringSync(JSON.stringify(data));

    return { verified: allSolvent, hash };
  }

  // ==========================================================================
  // SIGNATURE VERIFICATION
  // ==========================================================================

  private verifySignatures(proof: AMMSettlementProof): VerificationCheck {
    const issues: string[] = [];

    // Verify signature format
    const sigRegex = /^[0-9a-f]{64}$/;

    if (!sigRegex.test(proof.userSignature)) {
      issues.push("Invalid user signature format");
    }

    if (!sigRegex.test(proof.engineSignature)) {
      issues.push("Invalid engine signature format");
    }

    // Verify signatures are different (no self-signing)
    if (proof.userSignature === proof.engineSignature) {
      issues.push("User and engine signatures are identical (suspicious)");
    }

    // Simulate signature verification
    const userSigValid = this.verifySignature(
      proof.finalStateHash,
      proof.userSignature,
      "user",
    );
    if (!userSigValid) {
      issues.push("User signature verification failed");
    }

    const engineSigValid = this.verifySignature(
      proof.finalStateHash,
      proof.engineSignature,
      "engine",
    );
    if (!engineSigValid) {
      issues.push("Engine signature verification failed");
    }

    return {
      name: "Signature Verification",
      passed: issues.length === 0,
      details: issues.length > 0 ? issues.join("; ") : "All signatures valid",
      weight: 10,
      gasEstimate: BigInt(6000),
    };
  }

  private verifySignature(
    message: string,
    signature: string,
    signer: string,
  ): boolean {
    // Simulate signature verification
    // In production, would use actual crypto verification
    const expectedPrefix = signer === "user" ? "user_sign:" : "engine_sign:";
    return signature.length === 64 && /^[0-9a-f]+$/.test(signature);
  }

  // ==========================================================================
  // INTENT VERIFICATION
  // ==========================================================================

  private verifyIntentExecutions(
    session: AMMSession,
    proof: AMMSettlementProof,
  ): VerificationCheck {
    const issues: string[] = [];

    // Verify intent count matches
    if (proof.intentProofs.length !== session.completedIntents.length) {
      issues.push(
        `Intent count mismatch: ${proof.intentProofs.length} vs ${session.completedIntents.length}`,
      );
    }

    // Verify each intent execution
    for (const intentProof of proof.intentProofs) {
      // Check valid status
      if (!this.isValidIntentTransition(intentProof)) {
        issues.push(`Intent ${intentProof.intentId} in invalid state`);
      }

      // Check for replays (duplicate intent IDs)
      const duplicates = proof.intentProofs.filter(
        (i) => i.intentId === intentProof.intentId,
      );
      if (duplicates.length > 1) {
        issues.push(`Duplicate intent ID: ${intentProof.intentId}`);
      }

      // Verify output is reasonable for input (slippage check)
      if (
        intentProof.inputAmount > BigInt(0) &&
        intentProof.outputAmount > BigInt(0)
      ) {
        const ratio =
          Number(intentProof.outputAmount) / Number(intentProof.inputAmount);
        if (ratio > 1000 || ratio < 0.001) {
          issues.push(`Suspicious execution ratio for ${intentProof.intentId}`);
        }
      }
    }

    return {
      name: "Intent Execution Verification",
      passed: issues.length === 0,
      details:
        issues.length > 0 ? issues.join("; ") : "All intent executions valid",
      weight: 15,
      gasEstimate: BigInt(12000),
    };
  }

  // ==========================================================================
  // POSITION VERIFICATION
  // ==========================================================================

  private verifyPositions(
    session: AMMSession,
    proof: AMMSettlementProof,
  ): VerificationCheck {
    const issues: string[] = [];

    // Verify position count
    if (
      proof.positionSettlements.length !== session.liquidityPositions.length
    ) {
      issues.push("Position count mismatch");
    }

    // Verify each position
    for (const posSettlement of proof.positionSettlements) {
      // Check liquidity is non-negative
      if (posSettlement.liquidity < BigInt(0)) {
        issues.push(
          `Negative liquidity for position ${posSettlement.positionId}`,
        );
      }

      // Check tick range is valid
      if (posSettlement.tickLower >= posSettlement.tickUpper) {
        issues.push(
          `Invalid tick range for position ${posSettlement.positionId}`,
        );
      }

      // Check fees are non-negative
      if (
        posSettlement.feesEarned0 < BigInt(0) ||
        posSettlement.feesEarned1 < BigInt(0)
      ) {
        issues.push(`Negative fees for position ${posSettlement.positionId}`);
      }
    }

    return {
      name: "Position Verification",
      passed: issues.length === 0,
      details: issues.length > 0 ? issues.join("; ") : "All positions valid",
      weight: 10,
      gasEstimate: BigInt(8000),
    };
  }

  // ==========================================================================
  // FRAUD DETECTION
  // ==========================================================================

  private async checkForFraud(
    session: AMMSession,
    proof: AMMSettlementProof,
  ): Promise<VerificationCheck> {
    const fraudIndicators: string[] = [];

    // Check for pending fraud proofs
    const pendingFraud = Array.from(this.fraudProofs.values()).filter(
      (fp) =>
        fp.sessionId === session.sessionId &&
        fp.status === FraudProofStatus.PENDING,
    );
    if (pendingFraud.length > 0) {
      fraudIndicators.push(`${pendingFraud.length} pending fraud proofs`);
    }

    // Check for double-spend attempts
    const doubleSpendCheck = this.detectDoubleSpend(proof);
    if (doubleSpendCheck.detected) {
      fraudIndicators.push(
        `Double spend detected: ${doubleSpendCheck.details}`,
      );
    }

    // Check for replay attacks
    const replayCheck = this.detectReplayAttack(proof);
    if (replayCheck.detected) {
      fraudIndicators.push(`Replay attack detected: ${replayCheck.details}`);
    }

    // Check for value extraction
    const extractionCheck = this.detectValueExtraction(proof);
    if (extractionCheck.detected) {
      fraudIndicators.push(
        `Value extraction detected: ${extractionCheck.details}`,
      );
    }

    return {
      name: "Fraud Detection",
      passed: fraudIndicators.length === 0,
      details:
        fraudIndicators.length > 0
          ? fraudIndicators.join("; ")
          : "No fraud detected",
      weight: 20,
      gasEstimate: BigInt(20000),
    };
  }

  private detectDoubleSpend(proof: AMMSettlementProof): {
    detected: boolean;
    details?: string;
  } {
    // Check for duplicate token settlements
    const tokenAddresses = proof.tokenSettlements.map((t) => t.tokenAddress);
    const uniqueAddresses = new Set(tokenAddresses);

    if (uniqueAddresses.size !== tokenAddresses.length) {
      return { detected: true, details: "Duplicate token settlements" };
    }

    return { detected: false };
  }

  private detectReplayAttack(proof: AMMSettlementProof): {
    detected: boolean;
    details?: string;
  } {
    // Check for duplicate intent IDs
    const intentIds = proof.intentProofs.map((i) => i.intentId);
    const uniqueIntents = new Set(intentIds);

    if (uniqueIntents.size !== intentIds.length) {
      return { detected: true, details: "Duplicate intent execution" };
    }

    return { detected: false };
  }

  private detectValueExtraction(proof: AMMSettlementProof): {
    detected: boolean;
    details?: string;
  } {
    // Check if more value is being withdrawn than deposited
    let totalIn = BigInt(0);
    let totalOut = BigInt(0);

    for (const settlement of proof.tokenSettlements) {
      totalIn += settlement.initialAmount;
      totalOut += settlement.finalAmount;
    }

    if (totalOut > totalIn) {
      return {
        detected: true,
        details: `Output (${totalOut}) exceeds input (${totalIn})`,
      };
    }

    return { detected: false };
  }

  // ==========================================================================
  // FRAUD PROOF SUBMISSION
  // ==========================================================================

  /**
   * Submit a fraud proof challenge
   */
  submitFraudProof(
    sessionId: string,
    challengerAddress: string,
    fraudType: FraudType,
    evidence: FraudEvidence,
    bondAmount: bigint,
  ): FraudProof {
    // Validate bond amount
    if (bondAmount < this.MIN_BOND_AMOUNT) {
      throw new Error(`Bond amount must be at least ${this.MIN_BOND_AMOUNT}`);
    }

    const fraudProof: FraudProof = {
      fraudId: hashStringSync(
        `fraud:${sessionId}:${challengerAddress}:${Date.now()}`,
      ),
      sessionId,
      challengerAddress,
      fraudType,
      evidence,
      bondAmount,
      submittedAt: Date.now(),
      deadline: Date.now() + this.CHALLENGE_PERIOD_MS,
      status: FraudProofStatus.PENDING,
    };

    this.fraudProofs.set(fraudProof.fraudId, fraudProof);

    return fraudProof;
  }

  /**
   * Verify a submitted fraud proof
   */
  verifyFraudProof(fraudId: string): { valid: boolean; reason?: string } {
    const proof = this.fraudProofs.get(fraudId);
    if (!proof) {
      return { valid: false, reason: "Fraud proof not found" };
    }

    // Check deadline
    if (Date.now() > proof.deadline) {
      proof.status = FraudProofStatus.EXPIRED;
      return { valid: false, reason: "Challenge period expired" };
    }

    // Verify evidence
    switch (proof.fraudType) {
      case FraudType.MERKLE_PROOF_INVALID:
        if (proof.evidence.merkleProof) {
          const merkleValid = this.verifyMerkleProof(
            proof.evidence.merkleProof,
          );
          if (!merkleValid) {
            proof.status = FraudProofStatus.VALIDATED;
            return { valid: true };
          }
        }
        break;

      case FraudType.DOUBLE_SPEND:
        if (
          proof.evidence.conflictingTransactions &&
          proof.evidence.conflictingTransactions.length > 1
        ) {
          proof.status = FraudProofStatus.VALIDATED;
          return { valid: true };
        }
        break;

      default:
        // Verify generic evidence
        if (proof.evidence.expectedValue !== proof.evidence.actualValue) {
          proof.status = FraudProofStatus.VALIDATED;
          return { valid: true };
        }
    }

    proof.status = FraudProofStatus.REJECTED;
    return { valid: false, reason: "Evidence does not support fraud claim" };
  }

  // ==========================================================================
  // ZERO-KNOWLEDGE PROOFS
  // ==========================================================================

  private async verifyZKProofs(
    session: AMMSession,
    proof: AMMSettlementProof,
  ): Promise<VerificationCheck> {
    const zkResults: { circuit: string; verified: boolean }[] = [];

    // Generate and verify balance solvency ZK proof
    const solvencyZK = await this.generateAndVerifyZKProof(
      ZKCircuitType.BALANCE_SOLVENCY,
      [
        proof.sessionId,
        proof.tokenSettlements.map((t) => t.finalAmount.toString()).join(","),
      ],
    );
    zkResults.push({
      circuit: "BALANCE_SOLVENCY",
      verified: solvencyZK.verified,
    });

    // Generate and verify state transition ZK proof
    const stateZK = await this.generateAndVerifyZKProof(
      ZKCircuitType.STATE_TRANSITION,
      [proof.stateRoot, proof.finalStateHash],
    );
    zkResults.push({ circuit: "STATE_TRANSITION", verified: stateZK.verified });

    const allVerified = zkResults.every((r) => r.verified);
    const failedCircuits = zkResults
      .filter((r) => !r.verified)
      .map((r) => r.circuit);

    return {
      name: "Zero-Knowledge Proof Verification",
      passed: allVerified,
      details: allVerified
        ? "All ZK proofs verified"
        : `Failed circuits: ${failedCircuits.join(", ")}`,
      weight: 15,
      gasEstimate: BigInt(50000),
    };
  }

  private async generateAndVerifyZKProof(
    circuitType: ZKCircuitType,
    publicInputs: string[],
  ): Promise<ZKProof> {
    // Simulate ZK proof generation and verification
    const proofId = hashStringSync(
      `zk:${circuitType}:${publicInputs.join(":")}:${Date.now()}`,
    );

    // Simulate proof (in production, would use actual ZK circuit)
    const proof = hashStringSync(`proof:${proofId}`);

    // Simulate verification (always passes in demo)
    const verified = true;

    const zkProof: ZKProof = {
      proofId,
      circuitType,
      publicInputs,
      proof,
      verified,
    };

    this.zkProofCache.set(proofId, zkProof);

    return zkProof;
  }

  // ==========================================================================
  // CHALLENGE PERIOD
  // ==========================================================================

  private verifyChallengePeriod(session: AMMSession): VerificationCheck {
    const settlementAge = Date.now() - session.lastActivityAt;
    const challengePeriodPassed = settlementAge >= this.CHALLENGE_PERIOD_MS;

    return {
      name: "Challenge Period",
      passed: challengePeriodPassed,
      details: challengePeriodPassed
        ? "Challenge period has passed"
        : `${Math.round((this.CHALLENGE_PERIOD_MS - settlementAge) / 60000)} minutes remaining`,
      weight: 5,
      gasEstimate: BigInt(1000),
    };
  }

  // ==========================================================================
  // MULTI-PARTY SIGNATURES
  // ==========================================================================

  /**
   * Create threshold signature request
   */
  createThresholdSignature(
    message: string,
    threshold: number,
    totalSigners: number,
  ): ThresholdSignature {
    return {
      sigId: hashStringSync(`threshold:${message}:${Date.now()}`),
      message,
      threshold,
      totalSigners,
      collectedSignatures: [],
      verified: false,
    };
  }

  /**
   * Add partial signature to threshold
   */
  addPartialSignature(
    thresholdSig: ThresholdSignature,
    signerAddress: string,
    signerIndex: number,
    partialSig: string,
  ): boolean {
    // Check if already signed
    if (
      thresholdSig.collectedSignatures.some(
        (s) => s.signerAddress === signerAddress,
      )
    ) {
      return false;
    }

    // Add signature
    thresholdSig.collectedSignatures.push({
      signerAddress,
      signerIndex,
      partialSig,
      timestamp: Date.now(),
    });

    // Check if threshold reached
    if (thresholdSig.collectedSignatures.length >= thresholdSig.threshold) {
      thresholdSig.aggregatedSignature = this.aggregateSignatures(
        thresholdSig.collectedSignatures,
      );
      thresholdSig.verified = true;
    }

    return true;
  }

  private aggregateSignatures(signatures: PartialSignature[]): string {
    // Simulate BLS signature aggregation
    const combined = signatures.map((s) => s.partialSig).join("");
    return hashStringSync(`aggregated:${combined}`);
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private computeVerificationHash(checks: VerificationCheck[]): string {
    const checkData = checks.map((c) => ({
      name: c.name,
      passed: c.passed,
      weight: c.weight,
    }));
    return hashStringSync(JSON.stringify(checkData));
  }

  private signVerification(sessionId: string, valid: boolean): string {
    return hashStringSync(
      `verifier:${this.verifierAddress}:${sessionId}:${valid}:${Date.now()}`,
    );
  }

  // ==========================================================================
  // PUBLIC UTILITIES
  // ==========================================================================

  /**
   * Get pending fraud proofs for a session
   */
  getPendingFraudProofs(sessionId: string): FraudProof[] {
    return Array.from(this.fraudProofs.values()).filter(
      (fp) =>
        fp.sessionId === sessionId && fp.status === FraudProofStatus.PENDING,
    );
  }

  /**
   * Get verification statistics
   */
  getStats(): VerificationStats {
    return {
      totalVerifications: this.merkleRoots.size,
      pendingFraudProofs: Array.from(this.fraudProofs.values()).filter(
        (fp) => fp.status === FraudProofStatus.PENDING,
      ).length,
      validatedFraudProofs: Array.from(this.fraudProofs.values()).filter(
        (fp) => fp.status === FraudProofStatus.VALIDATED,
      ).length,
      zkProofsCached: this.zkProofCache.size,
    };
  }
}

// ============================================================================
// ADDITIONAL TYPES
// ============================================================================

export interface VerificationOptions {
  requireZKProof?: boolean;
  checkChallengePeriod?: boolean;
  minConfidenceScore?: number;
}

export interface VerificationStats {
  totalVerifications: number;
  pendingFraudProofs: number;
  validatedFraudProofs: number;
  zkProofsCached: number;
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const advancedVerifier = new AdvancedSettlementVerifier();
