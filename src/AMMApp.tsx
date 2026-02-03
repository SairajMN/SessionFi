/**
 * SessionFi + Uniswap v4 + Sui: Intent-Based AMM Sessions
 *
 * This demo application showcases the complete integration:
 * - SessionFi (Yellow Network) - Gasless sessions
 * - Uniswap v4 - Programmable AMM with hooks
 * - Sui - High-performance settlement
 * - LI.FI - Cross-chain liquidity routing
 *
 * MVP Features demonstrated:
 * 1. Intent-Based Swaps: Define swap outcomes, not steps
 * 2. Programmable Hooks: Custom logic for session-based AMM interactions
 * 3. Gasless Liquidity Provision: Add/remove liquidity without gas
 * 4. Cross-DEX Routing: Intent-based routing across multiple AMMs
 */

import React, { useState, useCallback, useRef } from "react";
import {
  AMMSession,
  AMMSessionStatus,
  Token,
  IntentType,
  IntentStatus,
  AMMIntent,
  ExactInputSwapIntent,
  AddLiquidityIntent,
  LiquidityPosition,
} from "./amm/types";
import { IntentEngine, intentEngine } from "./amm/engine/intent-engine";
import {
  SuiSettlementEngine,
  suiSettlementEngine,
} from "./amm/settlement/sui-settlement";
import { lifiRouter, SupportedChain } from "./amm/routing/lifi-router";
import { hashStringSync, generateKeyPair } from "./crypto/browser-primitives";

// ============================================================================
// DEMO TOKENS
// ============================================================================

const DEMO_TOKENS: Record<string, Token> = {
  USDC: {
    address: "0xUSDC",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    chainId: 1,
  },
  WETH: {
    address: "0xWETH",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    chainId: 1,
  },
  USDT: {
    address: "0xUSDT",
    symbol: "USDT",
    name: "Tether",
    decimals: 6,
    chainId: 1,
  },
  WBTC: {
    address: "0xWBTC",
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    decimals: 8,
    chainId: 1,
  },
};

// ============================================================================
// STATE TYPES
// ============================================================================

interface AppState {
  phase: "idle" | "session_active" | "settling" | "settled";
  session: AMMSession | null;
  userKeys: ReturnType<typeof generateKeyPair> | null;
  engineKeys: ReturnType<typeof generateKeyPair> | null;
  eventLog: EventLogEntry[];
  settlementResult: SettlementResult | null;
}

interface EventLogEntry {
  id: number;
  type: string;
  description: string;
  timestamp: number;
  gasUsed: number;
  details?: Record<string, unknown>;
}

interface SettlementResult {
  success: boolean;
  gasUsed: bigint;
  eventLogs: string[];
  tokenSettlements: Array<{
    token: string;
    initial: string;
    final: string;
    change: string;
  }>;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatAmount(amount: bigint, decimals: number = 6): string {
  const divisor = BigInt(10 ** decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;
  return `${whole}.${fraction.toString().padStart(decimals, "0").slice(0, 4)}`;
}

function formatGas(gas: bigint): string {
  return gas.toLocaleString();
}

function truncateHash(hash: string, length: number = 8): string {
  if (hash.length <= length * 2) return hash;
  return `${hash.slice(0, length)}...${hash.slice(-length)}`;
}

// ============================================================================
// MAIN APPLICATION
// ============================================================================

export default function AMMApp() {
  const [state, setState] = useState<AppState>({
    phase: "idle",
    session: null,
    userKeys: null,
    engineKeys: null,
    eventLog: [],
    settlementResult: null,
  });

  const [swapFrom, setSwapFrom] = useState("USDC");
  const [swapTo, setSwapTo] = useState("WETH");
  const [swapAmount, setSwapAmount] = useState("100");

  const eventIdRef = useRef(0);
  const engine = useRef(intentEngine);

  // ==========================================================================
  // SESSION MANAGEMENT
  // ==========================================================================

  const createSession = useCallback(() => {
    const userKeys = generateKeyPair("amm-user.eth");
    const engineKeys = generateKeyPair("sessionfi-engine");

    // Lock initial tokens
    const lockedTokens = new Map<string, bigint>();
    lockedTokens.set("0xUSDC", BigInt(10000000000)); // 10,000 USDC
    lockedTokens.set("0xWETH", BigInt("5000000000000000000")); // 5 WETH
    lockedTokens.set("0xUSDT", BigInt(5000000000)); // 5,000 USDT

    // Create session
    const session = engine.current.createSession(
      userKeys.address,
      "amm-user.eth",
      lockedTokens,
      Date.now() + 3600000, // 1 hour expiry
    );

    // Log event
    const logEntry: EventLogEntry = {
      id: eventIdRef.current++,
      type: "SESSION_CREATED",
      description: `AMM Session created with ${formatAmount(BigInt(10000000000))} USDC, 5 WETH, ${formatAmount(BigInt(5000000000))} USDT`,
      timestamp: Date.now(),
      gasUsed: 50000,
      details: {
        sessionId: session.sessionId,
        lockedTokens: Object.fromEntries(
          Array.from(session.lockedTokens.entries()).map(([k, v]) => [
            k,
            v.toString(),
          ]),
        ),
      },
    };

    setState({
      phase: "session_active",
      session,
      userKeys,
      engineKeys,
      eventLog: [logEntry],
      settlementResult: null,
    });
  }, []);

  // ==========================================================================
  // SWAP EXECUTION
  // ==========================================================================

  const executeSwap = useCallback(async () => {
    if (!state.session || !state.userKeys) return;

    const tokenIn = DEMO_TOKENS[swapFrom];
    const tokenOut = DEMO_TOKENS[swapTo];
    const amountIn = BigInt(parseFloat(swapAmount) * 10 ** tokenIn.decimals);

    // Create swap intent
    const intent = engine.current.createExactInputSwapIntent(
      state.session,
      tokenIn,
      tokenOut,
      amountIn,
      BigInt(0), // Min output (would calculate properly in production)
      {
        maxSlippageBps: 50,
        deadline: Date.now() + 300000,
      },
    );

    // Submit intent
    const submission = engine.current.submitIntent(
      state.session,
      intent,
      hashStringSync(`sign:${intent.intentId}:${state.userKeys.privateKey}`),
    );

    if (!submission.success) {
      console.error("Intent submission failed:", submission.error);
      return;
    }

    // Execute intent
    const result = await engine.current.executeIntent(state.session, intent);

    // Log event
    const logEntry: EventLogEntry = {
      id: eventIdRef.current++,
      type: "SWAP_EXECUTED",
      description: result.success
        ? `Swapped ${formatAmount(amountIn, tokenIn.decimals)} ${tokenIn.symbol} → ${formatAmount(result.amountOut || BigInt(0), tokenOut.decimals)} ${tokenOut.symbol}`
        : `Swap failed: ${result.error}`,
      timestamp: Date.now(),
      gasUsed: 0, // Gasless!
      details: {
        intentId: intent.intentId,
        amountIn: amountIn.toString(),
        amountOut: result.amountOut?.toString(),
        route: result.route,
        gasSaved: result.gasSaved?.toString(),
      },
    };

    setState((prev) => ({
      ...prev,
      eventLog: [...prev.eventLog, logEntry],
    }));
  }, [state.session, state.userKeys, swapFrom, swapTo, swapAmount]);

  // ==========================================================================
  // LIQUIDITY OPERATIONS
  // ==========================================================================

  const addLiquidity = useCallback(async () => {
    if (!state.session || !state.userKeys) return;

    // Find USDC/WETH pool
    const poolId = hashStringSync("0xUSDC:0xWETH:3000");

    const intent = engine.current.createAddLiquidityIntent(
      state.session,
      poolId,
      BigInt(1000000000), // 1000 USDC
      BigInt("400000000000000000"), // 0.4 WETH
      -60000, // tickLower
      60000, // tickUpper
      BigInt(0), // minLiquidity
      {},
    );

    const submission = engine.current.submitIntent(
      state.session,
      intent,
      hashStringSync(`sign:${intent.intentId}:${state.userKeys.privateKey}`),
    );

    if (!submission.success) {
      console.error("Liquidity intent failed:", submission.error);
      return;
    }

    const result = await engine.current.executeIntent(state.session, intent);

    const logEntry: EventLogEntry = {
      id: eventIdRef.current++,
      type: "LIQUIDITY_ADDED",
      description: result.success
        ? `Added liquidity: ${formatAmount(BigInt(1000000000))} USDC + ${formatAmount(BigInt("400000000000000000"), 18)} WETH`
        : `Add liquidity failed: ${result.error}`,
      timestamp: Date.now(),
      gasUsed: 0,
      details: {
        positionId: result.positionId,
        liquidity: result.liquidity?.toString(),
        gasSaved: result.gasSaved?.toString(),
      },
    };

    setState((prev) => ({
      ...prev,
      eventLog: [...prev.eventLog, logEntry],
    }));
  }, [state.session, state.userKeys]);

  const removeLiquidity = useCallback(async () => {
    if (
      !state.session ||
      !state.userKeys ||
      state.session.liquidityPositions.length === 0
    )
      return;

    const position = state.session.liquidityPositions[0];

    const intent = engine.current.createRemoveLiquidityIntent(
      state.session,
      position.positionId,
      position.liquidity,
      BigInt(0),
      BigInt(0),
      true, // Collect fees
      {},
    );

    const submission = engine.current.submitIntent(
      state.session,
      intent,
      hashStringSync(`sign:${intent.intentId}:${state.userKeys.privateKey}`),
    );

    if (!submission.success) {
      console.error("Remove liquidity failed:", submission.error);
      return;
    }

    const result = await engine.current.executeIntent(state.session, intent);

    const logEntry: EventLogEntry = {
      id: eventIdRef.current++,
      type: "LIQUIDITY_REMOVED",
      description: result.success
        ? `Removed liquidity: received ${formatAmount(result.amount0 || BigInt(0))} + ${formatAmount(result.amount1 || BigInt(0), 18)}`
        : `Remove liquidity failed: ${result.error}`,
      timestamp: Date.now(),
      gasUsed: 0,
      details: {
        amount0: result.amount0?.toString(),
        amount1: result.amount1?.toString(),
        fees0: result.fees0?.toString(),
        fees1: result.fees1?.toString(),
      },
    };

    setState((prev) => ({
      ...prev,
      eventLog: [...prev.eventLog, logEntry],
    }));
  }, [state.session, state.userKeys]);

  // ==========================================================================
  // BATCH OPERATIONS
  // ==========================================================================

  const executeBatchSwaps = useCallback(
    async (count: number) => {
      for (let i = 0; i < count; i++) {
        await executeSwap();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    [executeSwap],
  );

  // ==========================================================================
  // SETTLEMENT
  // ==========================================================================

  const settleSession = useCallback(async () => {
    if (!state.session || !state.userKeys || !state.engineKeys) return;

    setState((prev) => ({ ...prev, phase: "settling" }));

    // Generate settlement proof
    const proof = suiSettlementEngine.generateSettlementProof(
      state.session,
      state.userKeys.privateKey,
      state.engineKeys.privateKey,
    );

    // Execute settlement on Sui
    const result = await suiSettlementEngine.settleSession(
      state.session,
      proof,
      proof.userSignature,
      proof.engineSignature,
    );

    // Prepare settlement result
    const tokenSettlements = proof.tokenSettlements.map((t) => ({
      token: t.tokenAddress.replace("0x", ""),
      initial: formatAmount(t.initialAmount),
      final: formatAmount(t.finalAmount),
      change:
        t.netChange >= 0
          ? `+${formatAmount(t.netChange)}`
          : `-${formatAmount(-t.netChange)}`,
    }));

    const settlementResult: SettlementResult = {
      success: result.success,
      gasUsed: result.gasUsed,
      eventLogs: result.events.map(
        (e) => `${e.type}: ${JSON.stringify(e.data)}`,
      ),
      tokenSettlements,
    };

    const logEntry: EventLogEntry = {
      id: eventIdRef.current++,
      type: "SESSION_SETTLED",
      description: result.success
        ? `Session settled on Sui. Total intents: ${state.session.completedIntents.length}`
        : `Settlement failed: ${result.error}`,
      timestamp: Date.now(),
      gasUsed: Number(result.gasUsed),
      details: {
        digest: result.digest,
        totalVolume: state.session.totalSwapVolume.toString(),
        totalGasSaved: state.session.totalGasSaved.toString(),
      },
    };

    setState((prev) => ({
      ...prev,
      phase: "settled",
      settlementResult,
      eventLog: [...prev.eventLog, logEntry],
    }));
  }, [state.session, state.userKeys, state.engineKeys]);

  // ==========================================================================
  // RESET
  // ==========================================================================

  const resetDemo = useCallback(() => {
    setState({
      phase: "idle",
      session: null,
      userKeys: null,
      engineKeys: null,
      eventLog: [],
      settlementResult: null,
    });
    eventIdRef.current = 0;
  }, []);

  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <h1 style={styles.title}>SessionFi + Uniswap v4 + Sui</h1>
        <h2 style={styles.subtitle}>Intent-Based AMM Sessions</h2>
        <p style={styles.description}>
          Gasless DeFi operations with programmable hooks and high-performance
          settlement
        </p>
      </header>

      <main style={styles.main}>
        {/* Phase: Idle */}
        {state.phase === "idle" && (
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>🚀 Start Intent-Based AMM Session</h3>
            <p style={styles.cardDesc}>
              Create a session to perform unlimited gasless swaps and liquidity
              operations. Only settle the final result on-chain.
            </p>

            <div style={styles.infoBox}>
              <div style={styles.infoRow}>
                <span>Initial USDC</span>
                <span style={styles.infoValue}>10,000.00</span>
              </div>
              <div style={styles.infoRow}>
                <span>Initial WETH</span>
                <span style={styles.infoValue}>5.00</span>
              </div>
              <div style={styles.infoRow}>
                <span>Initial USDT</span>
                <span style={styles.infoValue}>5,000.00</span>
              </div>
              <div style={styles.infoRow}>
                <span>Session Duration</span>
                <span style={styles.infoValue}>1 hour</span>
              </div>
            </div>

            <button style={styles.primaryBtn} onClick={createSession}>
              🔗 Create AMM Session
            </button>

            <div style={styles.features}>
              <h4 style={styles.featuresTitle}>What You Can Do:</h4>
              <ul style={styles.featureList}>
                <li>✓ Intent-Based Swaps - Define outcomes, not steps</li>
                <li>✓ Gasless Liquidity - Add/remove LP without gas</li>
                <li>✓ Programmable Hooks - Custom v4 hook logic</li>
                <li>✓ Cross-DEX Routing - Via LI.FI integration</li>
                <li>✓ Atomic Settlement - All or nothing on Sui</li>
              </ul>
            </div>
          </div>
        )}

        {/* Phase: Session Active */}
        {state.phase === "session_active" && state.session && (
          <>
            {/* Session Status */}
            <div style={styles.card}>
              <div style={styles.statusHeader}>
                <span style={styles.statusDot}>🟢</span>
                <h3 style={styles.cardTitle}>Session Active</h3>
              </div>

              {/* Balances */}
              <div style={styles.balanceGrid}>
                {Array.from(state.session.availableTokens.entries()).map(
                  ([addr, amount]) => {
                    const token = Object.values(DEMO_TOKENS).find(
                      (t) => t.address === addr,
                    );
                    return (
                      <div key={addr} style={styles.balanceItem}>
                        <span style={styles.balanceSymbol}>
                          {token?.symbol || addr}
                        </span>
                        <span style={styles.balanceAmount}>
                          {formatAmount(amount, token?.decimals || 6)}
                        </span>
                      </div>
                    );
                  },
                )}
              </div>

              {/* Session Stats */}
              <div style={styles.statsRow}>
                <div style={styles.stat}>
                  <span style={styles.statLabel}>Nonce</span>
                  <span style={styles.statValue}>{state.session.nonce}</span>
                </div>
                <div style={styles.stat}>
                  <span style={styles.statLabel}>Intents</span>
                  <span style={styles.statValue}>
                    {state.session.completedIntents.length}
                  </span>
                </div>
                <div style={styles.stat}>
                  <span style={styles.statLabel}>Gas Saved</span>
                  <span style={styles.statValue}>
                    {formatGas(state.session.totalGasSaved)}
                  </span>
                </div>
                <div style={styles.stat}>
                  <span style={styles.statLabel}>Volume</span>
                  <span style={styles.statValue}>
                    ${formatAmount(state.session.totalSwapVolume)}
                  </span>
                </div>
              </div>

              {/* Positions */}
              {state.session.liquidityPositions.length > 0 && (
                <div style={styles.positionsSection}>
                  <h4 style={styles.sectionTitle}>
                    Liquidity Positions (
                    {state.session.liquidityPositions.length})
                  </h4>
                  {state.session.liquidityPositions.map((pos) => (
                    <div key={pos.positionId} style={styles.positionItem}>
                      <span>Pool: {truncateHash(pos.poolId)}</span>
                      <span>
                        Range: [{pos.tickLower}, {pos.tickUpper}]
                      </span>
                      <span>Liquidity: {pos.liquidity.toString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Swap Panel */}
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>⚡ Intent-Based Swap</h3>
              <p style={styles.gaslessNote}>All swaps are GASLESS</p>

              <div style={styles.swapForm}>
                <div style={styles.swapRow}>
                  <select
                    style={styles.select}
                    value={swapFrom}
                    onChange={(e) => setSwapFrom(e.target.value)}
                  >
                    {Object.keys(DEMO_TOKENS).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <input
                    style={styles.input}
                    type="number"
                    value={swapAmount}
                    onChange={(e) => setSwapAmount(e.target.value)}
                    placeholder="Amount"
                  />
                </div>

                <div style={styles.swapArrow}>↓</div>

                <div style={styles.swapRow}>
                  <select
                    style={styles.select}
                    value={swapTo}
                    onChange={(e) => setSwapTo(e.target.value)}
                  >
                    {Object.keys(DEMO_TOKENS)
                      .filter((t) => t !== swapFrom)
                      .map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                  </select>
                </div>

                <button style={styles.swapBtn} onClick={executeSwap}>
                  Submit Swap Intent
                </button>
              </div>

              <div style={styles.batchBtns}>
                <button
                  style={styles.batchBtn}
                  onClick={() => executeBatchSwaps(5)}
                >
                  Execute 5 Swaps
                </button>
                <button
                  style={styles.batchBtn}
                  onClick={() => executeBatchSwaps(10)}
                >
                  Execute 10 Swaps
                </button>
              </div>
            </div>

            {/* Liquidity Panel */}
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>💧 Gasless Liquidity</h3>
              <p style={styles.gaslessNote}>
                Add/Remove liquidity without paying gas
              </p>

              <div style={styles.liquidityBtns}>
                <button style={styles.liquidityBtn} onClick={addLiquidity}>
                  Add Liquidity (USDC/WETH)
                </button>
                <button
                  style={{
                    ...styles.liquidityBtn,
                    backgroundColor:
                      state.session.liquidityPositions.length > 0
                        ? "#ef4444"
                        : "#374151",
                    cursor:
                      state.session.liquidityPositions.length > 0
                        ? "pointer"
                        : "not-allowed",
                  }}
                  onClick={removeLiquidity}
                  disabled={state.session.liquidityPositions.length === 0}
                >
                  Remove Liquidity
                </button>
              </div>
            </div>

            {/* Settlement */}
            <div style={styles.card}>
              <button style={styles.settleBtn} onClick={settleSession}>
                📝 Settle Session on Sui
              </button>
              <p style={styles.settleNote}>
                Finalize all operations with a single on-chain transaction
              </p>
            </div>
          </>
        )}

        {/* Phase: Settling */}
        {state.phase === "settling" && (
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>⏳ Settling on Sui...</h3>
            <div style={styles.spinner}>Verifying proofs and settling...</div>
          </div>
        )}

        {/* Phase: Settled */}
        {state.phase === "settled" && state.settlementResult && (
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>
              {state.settlementResult.success
                ? "✅ Session Settled!"
                : "❌ Settlement Failed"}
            </h3>

            {state.settlementResult.success && (
              <>
                <div style={styles.settlementSummary}>
                  <h4>Token Settlements:</h4>
                  {state.settlementResult.tokenSettlements.map((t, i) => (
                    <div key={i} style={styles.settlementRow}>
                      <span>{t.token}</span>
                      <span>
                        {t.initial} → {t.final}
                      </span>
                      <span
                        style={{
                          color: t.change.startsWith("+")
                            ? "#10b981"
                            : "#ef4444",
                        }}
                      >
                        {t.change}
                      </span>
                    </div>
                  ))}
                </div>

                <div style={styles.gasComparison}>
                  <h4>Gas Savings</h4>
                  <div style={styles.comparisonRow}>
                    <span>Traditional (per-tx):</span>
                    <span>
                      ~{(state.eventLog.length - 1) * 150000} gas (
                      {state.eventLog.length - 1} txs)
                    </span>
                  </div>
                  <div style={styles.comparisonRow}>
                    <span>SessionFi:</span>
                    <span>~100,000 gas (2 txs)</span>
                  </div>
                  <div style={styles.savingsRow}>
                    <span>Savings:</span>
                    <span style={styles.savingsValue}>
                      {(
                        (((state.eventLog.length - 1) * 150000 - 100000) /
                          Math.max((state.eventLog.length - 1) * 150000, 1)) *
                        100
                      ).toFixed(1)}
                      %
                    </span>
                  </div>
                </div>
              </>
            )}

            <button style={styles.primaryBtn} onClick={resetDemo}>
              🔄 Start New Session
            </button>
          </div>
        )}

        {/* Event Log */}
        {state.eventLog.length > 0 && (
          <div style={styles.logCard}>
            <h3 style={styles.cardTitle}>📜 Session Event Log</h3>
            <div style={styles.logContainer}>
              {state.eventLog.map((entry) => (
                <div key={entry.id} style={styles.logEntry}>
                  <div style={styles.logHeader}>
                    <span
                      style={{
                        ...styles.logType,
                        backgroundColor: getEventColor(entry.type),
                      }}
                    >
                      {entry.type}
                    </span>
                    <span style={styles.logGas}>
                      Gas: {entry.gasUsed === 0 ? "FREE ⚡" : entry.gasUsed}
                    </span>
                  </div>
                  <p style={styles.logDesc}>{entry.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Architecture Diagram */}
        <div style={styles.architectureCard}>
          <h3 style={styles.cardTitle}>🏗️ Technical Architecture</h3>
          <div style={styles.architecture}>
            <div style={styles.archStep}>User Intent</div>
            <div style={styles.archArrow}>→</div>
            <div style={styles.archStep}>SessionFi (Yellow)</div>
            <div style={styles.archArrow}>→</div>
            <div style={styles.archStep}>Uniswap v4 Hooks</div>
            <div style={styles.archArrow}>→</div>
            <div style={styles.archStep}>Sui Settlement</div>
          </div>
          <div style={styles.archNote}>+ LI.FI for cross-chain routing</div>
        </div>

        {/* Innovation Points */}
        <div style={styles.innovationCard}>
          <h3 style={styles.cardTitle}>🌟 Why It's Novel</h3>
          <ul style={styles.innovationList}>
            <li>• First intent-based AMM system</li>
            <li>• Eliminates gas for liquidity operations</li>
            <li>
              • Enables complex AMM strategies without transaction overhead
            </li>
            <li>• Creates new primitive: "AMM session"</li>
          </ul>
        </div>
      </main>

      <footer style={styles.footer}>
        <p>
          Intent-Based AMM Sessions - Gasless DeFi with Programmable Hooks and
          High-Performance Settlement
        </p>
      </footer>
    </div>
  );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getEventColor(type: string): string {
  switch (type) {
    case "SESSION_CREATED":
      return "#3b82f6";
    case "SWAP_EXECUTED":
      return "#8b5cf6";
    case "LIQUIDITY_ADDED":
      return "#10b981";
    case "LIQUIDITY_REMOVED":
      return "#f59e0b";
    case "SESSION_SETTLED":
      return "#06b6d4";
    default:
      return "#6b7280";
  }
}

// ============================================================================
// STYLES
// ============================================================================

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    backgroundColor: "#0f172a",
    color: "#e2e8f0",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    textAlign: "center",
    padding: "2rem",
    background: "linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%)",
  },
  title: {
    fontSize: "2rem",
    fontWeight: "bold",
    margin: "0",
  },
  subtitle: {
    fontSize: "1.5rem",
    fontWeight: "600",
    margin: "0.5rem 0",
    color: "#a5b4fc",
  },
  description: {
    margin: "0.5rem 0 0",
    color: "#c7d2fe",
    fontSize: "0.875rem",
  },
  techBanner: {
    display: "flex",
    justifyContent: "center",
    gap: "2rem",
    padding: "1rem",
    backgroundColor: "#1e293b",
    borderBottom: "1px solid #334155",
    flexWrap: "wrap",
  },
  techItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  techIcon: {
    fontSize: "1.25rem",
  },
  techLabel: {
    fontWeight: "500",
  },
  techValue: {
    color: "#10b981",
    fontSize: "0.75rem",
    backgroundColor: "#064e3b",
    padding: "0.125rem 0.5rem",
    borderRadius: "9999px",
  },
  main: {
    maxWidth: "800px",
    margin: "0 auto",
    padding: "2rem",
  },
  card: {
    backgroundColor: "#1e293b",
    borderRadius: "0.75rem",
    padding: "1.5rem",
    marginBottom: "1rem",
  },
  cardTitle: {
    margin: "0 0 1rem",
    fontSize: "1.25rem",
    fontWeight: "600",
  },
  cardDesc: {
    color: "#94a3b8",
    marginBottom: "1.5rem",
  },
  infoBox: {
    backgroundColor: "#0f172a",
    borderRadius: "0.5rem",
    padding: "1rem",
    marginBottom: "1.5rem",
  },
  infoRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "0.5rem 0",
    borderBottom: "1px solid #1e293b",
  },
  infoValue: {
    fontWeight: "600",
    color: "#10b981",
  },
  primaryBtn: {
    width: "100%",
    padding: "1rem",
    fontSize: "1rem",
    fontWeight: "600",
    backgroundColor: "#3b82f6",
    color: "#fff",
    border: "none",
    borderRadius: "0.5rem",
    cursor: "pointer",
  },
  features: {
    marginTop: "1.5rem",
    padding: "1rem",
    backgroundColor: "#0f172a",
    borderRadius: "0.5rem",
  },
  featuresTitle: {
    margin: "0 0 0.5rem",
    fontSize: "0.875rem",
    color: "#94a3b8",
  },
  featureList: {
    margin: 0,
    paddingLeft: "1rem",
    fontSize: "0.875rem",
    color: "#cbd5e1",
    listStyle: "none",
  },
  statusHeader: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    marginBottom: "1rem",
  },
  statusDot: {
    fontSize: "1rem",
  },
  balanceGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "1rem",
    marginBottom: "1rem",
  },
  balanceItem: {
    backgroundColor: "#0f172a",
    padding: "1rem",
    borderRadius: "0.5rem",
    textAlign: "center",
  },
  balanceSymbol: {
    display: "block",
    fontSize: "0.75rem",
    color: "#94a3b8",
    marginBottom: "0.25rem",
  },
  balanceAmount: {
    fontSize: "1.25rem",
    fontWeight: "600",
    color: "#10b981",
  },
  statsRow: {
    display: "flex",
    justifyContent: "space-around",
    padding: "1rem 0",
    borderTop: "1px solid #334155",
  },
  stat: {
    textAlign: "center",
  },
  statLabel: {
    display: "block",
    fontSize: "0.75rem",
    color: "#94a3b8",
  },
  statValue: {
    fontSize: "1rem",
    fontWeight: "600",
  },
  positionsSection: {
    marginTop: "1rem",
    padding: "1rem",
    backgroundColor: "#0f172a",
    borderRadius: "0.5rem",
  },
  sectionTitle: {
    margin: "0 0 0.5rem",
    fontSize: "0.875rem",
    color: "#94a3b8",
  },
  positionItem: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "0.75rem",
    padding: "0.5rem 0",
    borderBottom: "1px solid #1e293b",
  },
  gaslessNote: {
    color: "#10b981",
    fontSize: "0.875rem",
    marginBottom: "1rem",
    textAlign: "center",
  },
  swapForm: {
    marginBottom: "1rem",
  },
  swapRow: {
    display: "flex",
    gap: "0.5rem",
    marginBottom: "0.5rem",
  },
  select: {
    flex: 1,
    padding: "0.75rem",
    backgroundColor: "#0f172a",
    color: "#e2e8f0",
    border: "1px solid #334155",
    borderRadius: "0.5rem",
    fontSize: "1rem",
  },
  input: {
    flex: 2,
    padding: "0.75rem",
    backgroundColor: "#0f172a",
    color: "#e2e8f0",
    border: "1px solid #334155",
    borderRadius: "0.5rem",
    fontSize: "1rem",
  },
  swapArrow: {
    textAlign: "center",
    fontSize: "1.5rem",
    padding: "0.5rem",
    color: "#94a3b8",
  },
  swapBtn: {
    width: "100%",
    padding: "1rem",
    backgroundColor: "#8b5cf6",
    color: "#fff",
    border: "none",
    borderRadius: "0.5rem",
    fontSize: "1rem",
    fontWeight: "600",
    cursor: "pointer",
    marginTop: "0.5rem",
  },
  batchBtns: {
    display: "flex",
    gap: "0.5rem",
  },
  batchBtn: {
    flex: 1,
    padding: "0.75rem",
    backgroundColor: "#6366f1",
    color: "#fff",
    border: "none",
    borderRadius: "0.5rem",
    cursor: "pointer",
  },
  liquidityBtns: {
    display: "flex",
    gap: "0.5rem",
  },
  liquidityBtn: {
    flex: 1,
    padding: "1rem",
    backgroundColor: "#10b981",
    color: "#fff",
    border: "none",
    borderRadius: "0.5rem",
    fontSize: "1rem",
    fontWeight: "600",
    cursor: "pointer",
  },
  settleBtn: {
    width: "100%",
    padding: "1.25rem",
    backgroundColor: "#f59e0b",
    color: "#000",
    border: "none",
    borderRadius: "0.5rem",
    fontSize: "1.125rem",
    fontWeight: "700",
    cursor: "pointer",
  },
  settleNote: {
    textAlign: "center",
    color: "#94a3b8",
    fontSize: "0.875rem",
    marginTop: "0.5rem",
    marginBottom: 0,
  },
  spinner: {
    textAlign: "center",
    padding: "2rem",
    color: "#94a3b8",
  },
  settlementSummary: {
    backgroundColor: "#0f172a",
    padding: "1rem",
    borderRadius: "0.5rem",
    marginBottom: "1rem",
  },
  settlementRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "0.5rem 0",
    borderBottom: "1px solid #1e293b",
    fontSize: "0.875rem",
  },
  gasComparison: {
    backgroundColor: "#0f172a",
    padding: "1rem",
    borderRadius: "0.5rem",
    marginBottom: "1.5rem",
  },
  comparisonRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "0.25rem 0",
    fontSize: "0.875rem",
  },
  savingsRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "0.5rem 0",
    marginTop: "0.5rem",
    borderTop: "1px solid #334155",
    fontWeight: "600",
  },
  savingsValue: {
    color: "#10b981",
  },
  logCard: {
    backgroundColor: "#1e293b",
    borderRadius: "0.75rem",
    padding: "1.5rem",
    marginBottom: "1rem",
    maxHeight: "400px",
    overflow: "hidden",
  },
  logContainer: {
    maxHeight: "320px",
    overflowY: "auto",
  },
  logEntry: {
    backgroundColor: "#0f172a",
    padding: "0.75rem",
    borderRadius: "0.5rem",
    marginBottom: "0.5rem",
  },
  logHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "0.5rem",
  },
  logType: {
    fontSize: "0.625rem",
    fontWeight: "600",
    color: "#fff",
    padding: "0.25rem 0.5rem",
    borderRadius: "0.25rem",
    textTransform: "uppercase",
  },
  logGas: {
    fontSize: "0.75rem",
    color: "#10b981",
  },
  logDesc: {
    margin: 0,
    fontSize: "0.875rem",
    color: "#cbd5e1",
  },
  architectureCard: {
    backgroundColor: "#1e293b",
    borderRadius: "0.75rem",
    padding: "1.5rem",
    marginBottom: "1rem",
    border: "1px solid #3b82f6",
  },
  architecture: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    flexWrap: "wrap",
    padding: "1rem 0",
  },
  archStep: {
    backgroundColor: "#3b82f6",
    padding: "0.5rem 1rem",
    borderRadius: "0.5rem",
    fontSize: "0.875rem",
    fontWeight: "500",
  },
  archArrow: {
    color: "#94a3b8",
    fontSize: "1.25rem",
  },
  archNote: {
    textAlign: "center",
    color: "#94a3b8",
    fontSize: "0.75rem",
    marginTop: "0.5rem",
  },
  innovationCard: {
    backgroundColor: "#1e293b",
    borderRadius: "0.75rem",
    padding: "1.5rem",
    marginBottom: "1rem",
    border: "1px solid #10b981",
  },
  innovationList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    fontSize: "0.875rem",
    color: "#cbd5e1",
  },
  footer: {
    textAlign: "center",
    padding: "2rem",
    borderTop: "1px solid #334155",
    color: "#64748b",
    fontSize: "0.875rem",
  },
};
