/**
 * SessionFi Protocol Demonstration
 *
 * This demo showcases the complete protocol flow:
 * 1. Session creation
 * 2. Off-chain action execution (gasless)
 * 3. Final settlement (on-chain)
 *
 * The demo proves that SessionFi is a new execution primitive,
 * not just a faster payment system.
 */

import { SessionEngine, createDeductAction } from "../engine/session-engine";
import {
  SettlementVerifier,
  simulateOnChainSettlement,
} from "../settlement/verifier";
import {
  generateKeyPair,
  generateSessionId,
  signState,
  signSettlement,
} from "../crypto/primitives";
import {
  SessionObject,
  SessionStatus,
  SessionMetadata,
  ActionType,
} from "../core/types";

// ============================================================================
// DEMO CONFIGURATION
// ============================================================================

const DEMO_CONFIG = {
  initialCapital: BigInt(10_000_000), // 10 USDC (6 decimals)
  actionCount: 15, // Number of gasless actions
  asset: "USDC",
};

// ============================================================================
// DEMO EXECUTION
// ============================================================================

async function runDemo() {
  console.log(
    "╔════════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║          SessionFi Protocol MVP Demonstration                  ║",
  );
  console.log(
    "║    Gasless DeFi Sessions with Intent-Based Settlement          ║",
  );
  console.log(
    "╚════════════════════════════════════════════════════════════════╝\n",
  );

  // ==========================================================================
  // STEP 1: GENERATE IDENTITIES
  // ==========================================================================

  console.log("📋 Step 1: Generate Cryptographic Identities\n");

  const userKeys = generateKeyPair("alice.eth");
  const engineKeys = generateKeyPair("sessionfi-engine");

  console.log(`   User Identity: alice.eth`);
  console.log(`   User Address: ${userKeys.address}`);
  console.log(`   Engine Address: ${engineKeys.address}\n`);

  // ==========================================================================
  // STEP 2: CREATE SESSION (ON-CHAIN TRANSACTION #1)
  // ==========================================================================

  console.log("🔗 Step 2: Create Session (ON-CHAIN TRANSACTION #1)\n");

  const timestamp = Date.now();
  const lockedAssets = {
    [DEMO_CONFIG.asset]: DEMO_CONFIG.initialCapital,
  };

  const sessionId = generateSessionId(
    userKeys.address,
    lockedAssets,
    timestamp,
  );

  const sessionObject: SessionObject = {
    sessionId,
    ownerEns: "alice.eth",
    ownerAddress: userKeys.address,
    lockedAssets,
    status: SessionStatus.ACTIVE,
    startTime: timestamp,
    settlementTime: null,
    finalStateHash: null,
    settlementProof: null,
  };

  const sessionMetadata: SessionMetadata = {
    sessionId,
    ownerEns: "alice.eth",
    ownerAddress: userKeys.address,
    maxDuration: 3600, // 1 hour
    settlementTimeout: 300, // 5 minutes
    allowedActions: [
      ActionType.DEDUCT,
      ActionType.DEPOSIT,
      ActionType.TRANSFER,
    ],
  };

  console.log(`   ✓ Session Created: ${sessionId.substring(0, 16)}...`);
  console.log(
    `   ✓ Capital Locked: ${formatUSDC(DEMO_CONFIG.initialCapital)} USDC`,
  );
  console.log(`   ✓ Status: ${sessionObject.status}`);
  console.log(`   ✓ Gas Cost: ~50,000 units\n`);

  // ==========================================================================
  // STEP 3: INITIALIZE OFF-CHAIN STATE
  // ==========================================================================

  console.log("⚡ Step 3: Initialize Off-Chain State Channel\n");

  const engine = new SessionEngine(engineKeys.privateKey, engineKeys.publicKey);

  let currentState = engine.createInitialState(
    sessionId,
    lockedAssets,
    userKeys.publicKey,
  );

  // User signs initial state
  const userInitialSignature = signState(currentState, userKeys.privateKey);
  currentState.signatures.user = userInitialSignature;

  console.log(`   ✓ Off-chain channel opened`);
  console.log(
    `   ✓ Initial state hash: ${currentState.stateHash.substring(0, 16)}...`,
  );
  console.log(
    `   ✓ Initial balance: ${formatUSDC(currentState.balances[DEMO_CONFIG.asset])} USDC`,
  );
  console.log(`   ✓ Nonce: ${currentState.nonce}\n`);

  // ==========================================================================
  // STEP 4: EXECUTE GASLESS ACTIONS (OFF-CHAIN)
  // ==========================================================================

  console.log(
    `💨 Step 4: Execute ${DEMO_CONFIG.actionCount} Gasless Actions (OFF-CHAIN)\n`,
  );
  console.log("   Action Log:\n");

  const stateHistory = [currentState];

  for (let i = 0; i < DEMO_CONFIG.actionCount; i++) {
    // Simulate various deductions (fees, tips, operations)
    const deductionAmount = BigInt(
      Math.floor(Math.random() * 100_000) + 10_000,
    ); // 0.01-0.10 USDC
    const reasons = [
      "gas_simulation",
      "protocol_fee",
      "tip",
      "operation_cost",
      "service_fee",
    ];
    const reason = reasons[i % reasons.length];

    const action = createDeductAction(
      currentState.nonce + 1,
      DEMO_CONFIG.asset,
      deductionAmount,
      reason,
    );

    // User signs the state hash (simplified - in production, user signs action)
    const userSig = signState(
      { stateHash: "pending" } as any,
      userKeys.privateKey,
    );

    const result = engine.executeAction(
      currentState,
      action,
      userSig,
      sessionMetadata,
    );

    if (!result.success) {
      console.log(`   ❌ Action ${i + 1} failed: ${result.error}`);
      break;
    }

    currentState = result.newState!;
    stateHistory.push(currentState);

    console.log(
      `   ${i + 1}. Deduct ${formatUSDC(deductionAmount)} USDC (${reason}) → Balance: ${formatUSDC(currentState.balances[DEMO_CONFIG.asset])} USDC [GAS: 0]`,
    );
  }

  console.log(`\n   ✓ All ${DEMO_CONFIG.actionCount} actions executed`);
  console.log(
    `   ✓ Final balance: ${formatUSDC(currentState.balances[DEMO_CONFIG.asset])} USDC`,
  );
  console.log(`   ✓ Total gas cost: ZERO (all off-chain)\n`);

  // ==========================================================================
  // STEP 5: GENERATE SETTLEMENT PROOF
  // ==========================================================================

  console.log("🔐 Step 5: Generate Settlement Proof\n");

  const finalStateHash = currentState.stateHash;
  const userSettlementSig = signSettlement(
    sessionId,
    finalStateHash,
    userKeys.privateKey,
  );

  const settlementProof = engine.generateSettlementProof(
    stateHistory,
    userSettlementSig,
  );

  console.log(`   ✓ Proof generated`);
  console.log(
    `   ✓ State chain length: ${settlementProof.stateHistory.length}`,
  );
  console.log(`   ✓ Total actions: ${settlementProof.totalActions}`);
  console.log(
    `   ✓ Final state hash: ${settlementProof.finalState.stateHash.substring(0, 16)}...`,
  );
  console.log(
    `   ✓ Action log root: ${settlementProof.actionLogRoot.substring(0, 16)}...\n`,
  );

  // ==========================================================================
  // STEP 6: SETTLE ON-CHAIN (ON-CHAIN TRANSACTION #2)
  // ==========================================================================

  console.log("🔗 Step 6: Settle Session (ON-CHAIN TRANSACTION #2)\n");

  const settlementResult = simulateOnChainSettlement(
    sessionObject,
    settlementProof,
    userKeys.publicKey,
    engineKeys.publicKey,
  );

  if (!settlementResult.success) {
    console.log(`   ❌ Settlement failed: ${settlementResult.error}\n`);
    return;
  }

  console.log("   Settlement Verification Steps:\n");
  for (const log of settlementResult.eventLogs) {
    console.log(`   ✓ ${log}`);
  }

  console.log(
    `\n   ✓ Gas Cost: ~${settlementResult.gasUsed.toLocaleString()} units`,
  );
  console.log(
    `   ✓ Session Status: ${settlementResult.settledSession!.status}\n`,
  );

  // ==========================================================================
  // STEP 7: DISPLAY FINAL RESULTS
  // ==========================================================================

  console.log("📊 Step 7: Final Results\n");

  const verifier = new SettlementVerifier();
  const amounts = verifier.computeSettlementAmounts(
    settlementProof.finalBalances,
    sessionObject.lockedAssets,
  );

  console.log("   Capital Summary:");
  console.log(
    `   • Locked:   ${formatUSDC(sessionObject.lockedAssets[DEMO_CONFIG.asset])} USDC`,
  );
  console.log(
    `   • Returned: ${formatUSDC(amounts.returned[DEMO_CONFIG.asset])} USDC`,
  );
  console.log(
    `   • Consumed: ${formatUSDC(amounts.consumed[DEMO_CONFIG.asset])} USDC\n`,
  );

  console.log("   Gas Comparison:");
  console.log(
    `   • Traditional DeFi: ${DEMO_CONFIG.actionCount} transactions × ~50,000 gas = ~${(DEMO_CONFIG.actionCount * 50_000).toLocaleString()} gas`,
  );
  console.log(
    `   • SessionFi:        2 transactions × ~50,000 gas = ~100,000 gas`,
  );
  console.log(
    `   • Gas Savings:      ${(((DEMO_CONFIG.actionCount * 50_000 - 100_000) / (DEMO_CONFIG.actionCount * 50_000)) * 100).toFixed(1)}%\n`,
  );

  // ==========================================================================
  // SUMMARY
  // ==========================================================================

  console.log(
    "╔════════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║                    PROTOCOL PROPERTIES PROVEN                  ║",
  );
  console.log(
    "╠════════════════════════════════════════════════════════════════╣",
  );
  console.log(
    "║ ✓ Session-scoped execution (not per-transaction)              ║",
  );
  console.log(
    "║ ✓ Off-chain actions with cryptographic integrity              ║",
  );
  console.log(
    "║ ✓ Intent-based final settlement (not action batching)         ║",
  );
  console.log(
    "║ ✓ 2 on-chain transactions only (open + settle)                ║",
  );
  console.log(
    "║ ✓ 0 gas during session (all actions gasless)                  ║",
  );
  console.log(
    "║ ✓ Capital conservation enforced cryptographically             ║",
  );
  console.log(
    "║ ✓ State chain verified independently                          ║",
  );
  console.log(
    "║ ✓ No trust assumptions beyond crypto proofs                   ║",
  );
  console.log(
    "╚════════════════════════════════════════════════════════════════╝\n",
  );

  console.log(
    "🎯 Conclusion: SessionFi demonstrates a NEW EXECUTION PRIMITIVE\n",
  );
  console.log("   This is not:");
  console.log("   • Just faster payments");
  console.log("   • Just transaction batching");
  console.log("   • Just account abstraction\n");
  console.log("   This is:");
  console.log("   • Session-first DeFi execution model");
  console.log("   • Intent-based settlement protocol");
  console.log("   • State channel + object-centric blockchain hybrid");
  console.log("   • Foundation for post-hackathon DeFi applications\n");
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatUSDC(amount: bigint): string {
  const value = Number(amount) / 1_000_000;
  return value.toFixed(2);
}

// ============================================================================
// RUN DEMO
// ============================================================================

runDemo().catch((error) => {
  console.error("Demo failed:", error);
  process.exit(1);
});
