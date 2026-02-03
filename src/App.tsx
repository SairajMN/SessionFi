/**
 * SessionFi Protocol MVP Application
 *
 * This React application demonstrates the complete SessionFi protocol flow:
 * 1. Session creation (on-chain transaction #1)
 * 2. Off-chain gasless actions
 * 3. Settlement (on-chain transaction #2)
 *
 * The UI is minimal and protocol-focused, not polished UX.
 * Every interaction maps directly to a protocol operation.
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  SessionObject,
  SessionStatus,
  SessionMetadata,
  SessionState,
  ActionType,
  Action,
  SettlementProof,
} from "./core/types";
import {
  BrowserSessionEngine,
  createDeductAction,
  createDepositAction,
  createTransferAction,
} from "./engine/browser-session-engine";
import {
  BrowserSettlementVerifier,
  simulateOnChainSettlement,
} from "./settlement/browser-verifier";
import {
  generateKeyPair,
  generateSessionId,
  signState,
  signSettlement,
} from "./crypto/browser-primitives";

// ============================================================================
// TYPES
// ============================================================================

interface ProtocolState {
  phase: "idle" | "session_active" | "settling" | "settled";
  userKeys: ReturnType<typeof generateKeyPair> | null;
  engineKeys: ReturnType<typeof generateKeyPair> | null;
  sessionObject: SessionObject | null;
  sessionMetadata: SessionMetadata | null;
  currentState: SessionState | null;
  stateHistory: SessionState[];
  engine: BrowserSessionEngine | null;
  actionLog: ActionLogEntry[];
  settlementResult: SettlementResult | null;
}

interface ActionLogEntry {
  id: number;
  type: string;
  description: string;
  amount?: string;
  gasUsed: number;
  timestamp: number;
  stateHash: string;
  nonce: number;
}

interface SettlementResult {
  success: boolean;
  gasUsed: number;
  eventLogs: string[];
  returned: Record<string, bigint>;
  consumed: Record<string, bigint>;
  error?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEMO_CONFIG = {
  initialCapital: BigInt(10_000_000), // 10 USDC (6 decimals)
  asset: "USDC",
  userIdentity: "alice.eth",
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatUSDC(amount: bigint): string {
  const value = Number(amount) / 1_000_000;
  return value.toFixed(2);
}

function truncateHash(hash: string, length: number = 8): string {
  if (hash.length <= length * 2) return hash;
  return `${hash.slice(0, length)}...${hash.slice(-length)}`;
}

// ============================================================================
// MAIN APPLICATION COMPONENT
// ============================================================================

export default function App() {
  const [state, setState] = useState<ProtocolState>({
    phase: "idle",
    userKeys: null,
    engineKeys: null,
    sessionObject: null,
    sessionMetadata: null,
    currentState: null,
    stateHistory: [],
    engine: null,
    actionLog: [],
    settlementResult: null,
  });

  const actionIdRef = useRef(0);

  // ==========================================================================
  // PHASE 1: SESSION CREATION
  // ==========================================================================

  const createSession = useCallback(() => {
    // Generate cryptographic identities
    const userKeys = generateKeyPair(DEMO_CONFIG.userIdentity);
    const engineKeys = generateKeyPair("sessionfi-engine");

    // Create session ID
    const timestamp = Date.now();
    const lockedAssets = {
      [DEMO_CONFIG.asset]: DEMO_CONFIG.initialCapital,
    };

    const sessionId = generateSessionId(
      userKeys.address,
      lockedAssets,
      timestamp,
    );

    // Create session object (simulates on-chain creation)
    const sessionObject: SessionObject = {
      sessionId,
      ownerEns: DEMO_CONFIG.userIdentity,
      ownerAddress: userKeys.address,
      lockedAssets,
      status: SessionStatus.ACTIVE,
      startTime: timestamp,
      settlementTime: null,
      finalStateHash: null,
      settlementProof: null,
    };

    // Create session metadata
    const sessionMetadata: SessionMetadata = {
      sessionId,
      ownerEns: DEMO_CONFIG.userIdentity,
      ownerAddress: userKeys.address,
      maxDuration: 3600,
      settlementTimeout: 300,
      allowedActions: [
        ActionType.DEDUCT,
        ActionType.DEPOSIT,
        ActionType.TRANSFER,
      ],
    };

    // Initialize off-chain engine
    const engine = new BrowserSessionEngine(
      engineKeys.privateKey,
      engineKeys.publicKey,
    );

    // Create initial state
    let initialState = engine.createInitialState(
      sessionId,
      lockedAssets,
      userKeys.publicKey,
    );

    // User signs initial state
    const userSignature = signState(initialState, userKeys.privateKey);
    initialState = {
      ...initialState,
      signatures: {
        ...initialState.signatures,
        user: userSignature,
      },
    };

    // Log session creation
    actionIdRef.current = 0;
    const creationLog: ActionLogEntry = {
      id: actionIdRef.current++,
      type: "SESSION_CREATE",
      description: `Session created with ${formatUSDC(DEMO_CONFIG.initialCapital)} USDC locked`,
      gasUsed: 50000,
      timestamp: Date.now(),
      stateHash: initialState.stateHash,
      nonce: 0,
    };

    setState({
      phase: "session_active",
      userKeys,
      engineKeys,
      sessionObject,
      sessionMetadata,
      currentState: initialState,
      stateHistory: [initialState],
      engine,
      actionLog: [creationLog],
      settlementResult: null,
    });
  }, []);

  // ==========================================================================
  // PHASE 2: OFF-CHAIN ACTIONS
  // ==========================================================================

  const executeAction = useCallback(
    (actionType: "deduct" | "deposit" | "transfer", amount: bigint) => {
      if (
        !state.engine ||
        !state.currentState ||
        !state.userKeys ||
        !state.sessionMetadata
      ) {
        return;
      }

      const nonce = state.currentState.nonce + 1;
      let action: Action;
      let description: string;

      switch (actionType) {
        case "deduct":
          action = createDeductAction(
            nonce,
            DEMO_CONFIG.asset,
            amount,
            "protocol_fee",
          );
          description = `Deduct ${formatUSDC(amount)} USDC (fee)`;
          break;
        case "deposit":
          action = createDepositAction(
            nonce,
            DEMO_CONFIG.asset,
            amount,
            "reward",
          );
          description = `Deposit ${formatUSDC(amount)} USDC (reward)`;
          break;
        case "transfer":
          action = createTransferAction(
            nonce,
            DEMO_CONFIG.asset,
            amount,
            state.userKeys.address,
            "recipient",
          );
          description = `Transfer ${formatUSDC(amount)} USDC`;
          break;
      }

      // User signs the action (simplified - signs state hash)
      const userSignature = signState(
        { stateHash: "pending" } as SessionState,
        state.userKeys.privateKey,
      );

      // Execute action through engine
      const result = state.engine.executeAction(
        state.currentState,
        action,
        userSignature,
        state.sessionMetadata,
      );

      if (!result.success || !result.newState) {
        console.error("Action failed:", result.error);
        return;
      }

      // Log action
      const logEntry: ActionLogEntry = {
        id: actionIdRef.current++,
        type: actionType.toUpperCase(),
        description,
        amount: formatUSDC(amount),
        gasUsed: 0, // Off-chain = no gas
        timestamp: Date.now(),
        stateHash: result.newState.stateHash,
        nonce: result.newState.nonce,
      };

      setState((prev) => ({
        ...prev,
        currentState: result.newState!,
        stateHistory: [...prev.stateHistory, result.newState!],
        actionLog: [...prev.actionLog, logEntry],
      }));
    },
    [state],
  );

  const executeRandomAction = useCallback(() => {
    // Random deduction between 0.01 and 0.15 USDC
    const amount = BigInt(Math.floor(Math.random() * 140000) + 10000);
    executeAction("deduct", amount);
  }, [executeAction]);

  const executeBatchActions = useCallback(
    (count: number) => {
      for (let i = 0; i < count; i++) {
        setTimeout(() => executeRandomAction(), i * 100);
      }
    },
    [executeRandomAction],
  );

  // ==========================================================================
  // PHASE 3: SETTLEMENT
  // ==========================================================================

  const settleSession = useCallback(() => {
    if (
      !state.engine ||
      !state.currentState ||
      !state.userKeys ||
      !state.engineKeys ||
      !state.sessionObject ||
      !state.stateHistory.length
    ) {
      return;
    }

    setState((prev) => ({ ...prev, phase: "settling" }));

    // Generate settlement signature
    const settlementSignature = signSettlement(
      state.sessionObject.sessionId,
      state.currentState.stateHash,
      state.userKeys.privateKey,
    );

    // Generate settlement proof
    const proof = state.engine.generateSettlementProof(
      state.stateHistory,
      settlementSignature,
    );

    // Execute on-chain settlement (simulated)
    const result = simulateOnChainSettlement(
      state.sessionObject,
      proof,
      state.userKeys.publicKey,
      state.engineKeys.publicKey,
    );

    // Compute settlement amounts
    const verifier = new BrowserSettlementVerifier();
    const amounts = verifier.computeSettlementAmounts(
      proof.finalBalances,
      state.sessionObject.lockedAssets,
    );

    // Log settlement
    const settlementLog: ActionLogEntry = {
      id: actionIdRef.current++,
      type: "SETTLEMENT",
      description: `Session settled - Returned: ${formatUSDC(amounts.returned[DEMO_CONFIG.asset])} USDC`,
      gasUsed: result.gasUsed,
      timestamp: Date.now(),
      stateHash: state.currentState.stateHash,
      nonce: state.currentState.nonce,
    };

    const settlementResult: SettlementResult = {
      success: result.success,
      gasUsed: result.gasUsed,
      eventLogs: result.eventLogs,
      returned: amounts.returned,
      consumed: amounts.consumed,
      error: result.error,
    };

    setState((prev) => ({
      ...prev,
      phase: "settled",
      sessionObject: result.settledSession || prev.sessionObject,
      actionLog: [...prev.actionLog, settlementLog],
      settlementResult,
    }));
  }, [state]);

  // ==========================================================================
  // RESET
  // ==========================================================================

  const resetDemo = useCallback(() => {
    setState({
      phase: "idle",
      userKeys: null,
      engineKeys: null,
      sessionObject: null,
      sessionMetadata: null,
      currentState: null,
      stateHistory: [],
      engine: null,
      actionLog: [],
      settlementResult: null,
    });
  }, []);

  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>SessionFi Protocol MVP</h1>
        <p style={styles.subtitle}>
          Gasless DeFi Sessions with Intent-Based Final Settlement
        </p>
      </header>

      <main style={styles.main}>
        {/* Protocol Phase Indicator */}
        <div style={styles.phaseIndicator}>
          <PhaseStep
            number={1}
            label="Create Session"
            active={state.phase === "idle"}
            complete={state.phase !== "idle"}
          />
          <PhaseConnector complete={state.phase !== "idle"} />
          <PhaseStep
            number={2}
            label="Off-Chain Actions"
            active={state.phase === "session_active"}
            complete={state.phase === "settling" || state.phase === "settled"}
          />
          <PhaseConnector
            complete={state.phase === "settling" || state.phase === "settled"}
          />
          <PhaseStep
            number={3}
            label="Settlement"
            active={state.phase === "settling"}
            complete={state.phase === "settled"}
          />
        </div>

        {/* Phase 1: Idle */}
        {state.phase === "idle" && (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Start a DeFi Session</h2>
            <p style={styles.cardDescription}>
              Lock capital once. Perform unlimited gasless actions. Settle only
              the final result on-chain.
            </p>
            <div style={styles.infoBox}>
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>Identity:</span>
                <span style={styles.infoValue}>{DEMO_CONFIG.userIdentity}</span>
              </div>
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>Capital to Lock:</span>
                <span style={styles.infoValue}>
                  {formatUSDC(DEMO_CONFIG.initialCapital)} USDC
                </span>
              </div>
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>On-Chain Cost:</span>
                <span style={styles.infoValue}>~50,000 gas (one-time)</span>
              </div>
            </div>
            <button style={styles.primaryButton} onClick={createSession}>
              🔗 Create Session (Sign Once)
            </button>
          </div>
        )}

        {/* Phase 2: Session Active */}
        {state.phase === "session_active" && state.currentState && (
          <div style={styles.activeSessionContainer}>
            {/* Session Info */}
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>🟢 Session Active</h2>
              <div style={styles.sessionInfo}>
                <div style={styles.balanceDisplay}>
                  <span style={styles.balanceLabel}>Current Balance</span>
                  <span style={styles.balanceValue}>
                    {formatUSDC(
                      state.currentState.balances[DEMO_CONFIG.asset] ||
                        BigInt(0),
                    )}{" "}
                    USDC
                  </span>
                </div>
                <div style={styles.statsRow}>
                  <div style={styles.stat}>
                    <span style={styles.statLabel}>Nonce</span>
                    <span style={styles.statValue}>
                      {state.currentState.nonce}
                    </span>
                  </div>
                  <div style={styles.stat}>
                    <span style={styles.statLabel}>Actions</span>
                    <span style={styles.statValue}>
                      {state.actionLog.length - 1}
                    </span>
                  </div>
                  <div style={styles.stat}>
                    <span style={styles.statLabel}>Gas Used</span>
                    <span style={styles.statValue}>0</span>
                  </div>
                </div>
                <div style={styles.hashDisplay}>
                  <span style={styles.hashLabel}>State Hash:</span>
                  <code style={styles.hashValue}>
                    {truncateHash(state.currentState.stateHash, 12)}
                  </code>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div style={styles.card}>
              <h3 style={styles.cardSubtitle}>Execute Gasless Actions</h3>
              <p style={styles.gaslessNote}>
                ⚡ All actions below are FREE (off-chain)
              </p>
              <div style={styles.actionButtons}>
                <button
                  style={styles.actionButton}
                  onClick={() => executeAction("deduct", BigInt(50000))}
                >
                  Deduct 0.05 USDC
                </button>
                <button
                  style={styles.actionButton}
                  onClick={() => executeAction("deduct", BigInt(100000))}
                >
                  Deduct 0.10 USDC
                </button>
                <button
                  style={styles.actionButton}
                  onClick={executeRandomAction}
                >
                  Random Action
                </button>
              </div>
              <div style={styles.batchButtons}>
                <button
                  style={styles.batchButton}
                  onClick={() => executeBatchActions(5)}
                >
                  Execute 5 Actions
                </button>
                <button
                  style={styles.batchButton}
                  onClick={() => executeBatchActions(10)}
                >
                  Execute 10 Actions
                </button>
              </div>
              <button style={styles.settleButton} onClick={settleSession}>
                📝 End Session & Settle
              </button>
            </div>
          </div>
        )}

        {/* Phase 3: Settling */}
        {state.phase === "settling" && (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>⏳ Settlement in Progress...</h2>
            <div style={styles.loadingSpinner}>Verifying proofs...</div>
          </div>
        )}

        {/* Phase 4: Settled */}
        {state.phase === "settled" && state.settlementResult && (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>
              {state.settlementResult.success
                ? "✅ Session Settled"
                : "❌ Settlement Failed"}
            </h2>

            {state.settlementResult.success && (
              <>
                <div style={styles.settlementSummary}>
                  <div style={styles.summaryItem}>
                    <span style={styles.summaryLabel}>Locked</span>
                    <span style={styles.summaryValue}>
                      {formatUSDC(DEMO_CONFIG.initialCapital)} USDC
                    </span>
                  </div>
                  <div style={styles.summaryItem}>
                    <span style={styles.summaryLabel}>Returned</span>
                    <span style={styles.summaryValueGreen}>
                      {formatUSDC(
                        state.settlementResult.returned[DEMO_CONFIG.asset],
                      )}{" "}
                      USDC
                    </span>
                  </div>
                  <div style={styles.summaryItem}>
                    <span style={styles.summaryLabel}>Consumed</span>
                    <span style={styles.summaryValueRed}>
                      {formatUSDC(
                        state.settlementResult.consumed[DEMO_CONFIG.asset],
                      )}{" "}
                      USDC
                    </span>
                  </div>
                </div>

                <div style={styles.gasComparison}>
                  <h4 style={styles.comparisonTitle}>Gas Comparison</h4>
                  <div style={styles.comparisonRow}>
                    <span>Traditional DeFi:</span>
                    <span>
                      {(state.actionLog.length - 1) * 50000} gas (
                      {state.actionLog.length - 1} transactions)
                    </span>
                  </div>
                  <div style={styles.comparisonRow}>
                    <span>SessionFi:</span>
                    <span>~100,000 gas (2 transactions)</span>
                  </div>
                  <div style={styles.savingsRow}>
                    <span>Savings:</span>
                    <span style={styles.savings}>
                      {(
                        (((state.actionLog.length - 1) * 50000 - 100000) /
                          ((state.actionLog.length - 1) * 50000)) *
                          100 || 0
                      ).toFixed(1)}
                      %
                    </span>
                  </div>
                </div>

                <div style={styles.eventLogs}>
                  <h4 style={styles.logsTitle}>Settlement Event Log</h4>
                  {state.settlementResult.eventLogs.map((log, i) => (
                    <div key={i} style={styles.logEntry}>
                      ✓ {log}
                    </div>
                  ))}
                </div>
              </>
            )}

            <button style={styles.primaryButton} onClick={resetDemo}>
              🔄 Start New Session
            </button>
          </div>
        )}

        {/* Action Log */}
        {state.actionLog.length > 0 && (
          <div style={styles.logCard}>
            <h3 style={styles.logTitle}>Action Log</h3>
            <div style={styles.logContainer}>
              {state.actionLog.map((entry) => (
                <div key={entry.id} style={styles.logItem}>
                  <div style={styles.logItemHeader}>
                    <span
                      style={{
                        ...styles.logType,
                        backgroundColor:
                          entry.type === "SESSION_CREATE"
                            ? "#3b82f6"
                            : entry.type === "SETTLEMENT"
                              ? "#10b981"
                              : "#8b5cf6",
                      }}
                    >
                      {entry.type}
                    </span>
                    <span style={styles.logGas}>
                      Gas: {entry.gasUsed.toLocaleString()}
                    </span>
                  </div>
                  <p style={styles.logDescription}>{entry.description}</p>
                  <div style={styles.logMeta}>
                    <span>Nonce: {entry.nonce}</span>
                    <span>Hash: {truncateHash(entry.stateHash, 6)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Protocol Properties */}
        <div style={styles.propertiesCard}>
          <h3 style={styles.propertiesTitle}>
            Protocol Properties Demonstrated
          </h3>
          <ul style={styles.propertiesList}>
            <li>✓ Session-scoped execution (not per-transaction)</li>
            <li>✓ Off-chain actions with cryptographic integrity</li>
            <li>✓ Intent-based final settlement (not action batching)</li>
            <li>✓ 2 on-chain transactions only (open + settle)</li>
            <li>✓ 0 gas during session (all actions gasless)</li>
            <li>✓ Capital conservation enforced cryptographically</li>
            <li>✓ State chain verified independently</li>
            <li>✓ No trust assumptions beyond crypto proofs</li>
          </ul>
        </div>
      </main>

      <footer style={styles.footer}>
        <p>
          SessionFi demonstrates a new execution primitive for DeFi. Sessions
          instead of transactions. Intent instead of per-action settlement.
        </p>
      </footer>
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function PhaseStep({
  number,
  label,
  active,
  complete,
}: {
  number: number;
  label: string;
  active: boolean;
  complete: boolean;
}) {
  return (
    <div style={styles.phaseStep}>
      <div
        style={{
          ...styles.phaseNumber,
          backgroundColor: complete
            ? "#10b981"
            : active
              ? "#3b82f6"
              : "#374151",
          borderColor: complete ? "#10b981" : active ? "#3b82f6" : "#374151",
        }}
      >
        {complete ? "✓" : number}
      </div>
      <span
        style={{
          ...styles.phaseLabel,
          color: active || complete ? "#fff" : "#9ca3af",
        }}
      >
        {label}
      </span>
    </div>
  );
}

function PhaseConnector({ complete }: { complete: boolean }) {
  return (
    <div
      style={{
        ...styles.phaseConnector,
        backgroundColor: complete ? "#10b981" : "#374151",
      }}
    />
  );
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
    borderBottom: "1px solid #1e293b",
  },
  title: {
    fontSize: "2rem",
    fontWeight: "bold",
    color: "#fff",
    margin: "0 0 0.5rem 0",
  },
  subtitle: {
    fontSize: "1rem",
    color: "#94a3b8",
    margin: 0,
  },
  main: {
    maxWidth: "800px",
    margin: "0 auto",
    padding: "2rem",
  },
  phaseIndicator: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: "2rem",
    gap: "0.5rem",
  },
  phaseStep: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.5rem",
  },
  phaseNumber: {
    width: "2.5rem",
    height: "2.5rem",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: "bold",
    fontSize: "1rem",
    border: "2px solid",
  },
  phaseLabel: {
    fontSize: "0.75rem",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  phaseConnector: {
    width: "3rem",
    height: "2px",
    marginBottom: "1.5rem",
  },
  card: {
    backgroundColor: "#1e293b",
    borderRadius: "0.75rem",
    padding: "1.5rem",
    marginBottom: "1rem",
  },
  cardTitle: {
    fontSize: "1.25rem",
    fontWeight: "bold",
    margin: "0 0 1rem 0",
    color: "#fff",
  },
  cardSubtitle: {
    fontSize: "1rem",
    fontWeight: "600",
    margin: "0 0 0.5rem 0",
    color: "#fff",
  },
  cardDescription: {
    color: "#94a3b8",
    marginBottom: "1.5rem",
    lineHeight: 1.6,
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
  infoLabel: {
    color: "#94a3b8",
  },
  infoValue: {
    color: "#fff",
    fontWeight: "500",
  },
  primaryButton: {
    width: "100%",
    padding: "1rem",
    fontSize: "1rem",
    fontWeight: "600",
    color: "#fff",
    backgroundColor: "#3b82f6",
    border: "none",
    borderRadius: "0.5rem",
    cursor: "pointer",
    transition: "background-color 0.2s",
  },
  activeSessionContainer: {
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
  },
  sessionInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
  },
  balanceDisplay: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "1.5rem",
    backgroundColor: "#0f172a",
    borderRadius: "0.5rem",
  },
  balanceLabel: {
    color: "#94a3b8",
    fontSize: "0.875rem",
  },
  balanceValue: {
    fontSize: "2rem",
    fontWeight: "bold",
    color: "#10b981",
  },
  statsRow: {
    display: "flex",
    justifyContent: "space-around",
  },
  stat: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  statLabel: {
    color: "#94a3b8",
    fontSize: "0.75rem",
  },
  statValue: {
    fontSize: "1.25rem",
    fontWeight: "600",
    color: "#fff",
  },
  hashDisplay: {
    display: "flex",
    justifyContent: "center",
    gap: "0.5rem",
    alignItems: "center",
  },
  hashLabel: {
    color: "#94a3b8",
    fontSize: "0.875rem",
  },
  hashValue: {
    color: "#8b5cf6",
    fontSize: "0.875rem",
    fontFamily: "monospace",
  },
  gaslessNote: {
    color: "#10b981",
    fontSize: "0.875rem",
    marginBottom: "1rem",
    textAlign: "center",
  },
  actionButtons: {
    display: "flex",
    gap: "0.5rem",
    marginBottom: "1rem",
  },
  actionButton: {
    flex: 1,
    padding: "0.75rem",
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "#fff",
    backgroundColor: "#4f46e5",
    border: "none",
    borderRadius: "0.5rem",
    cursor: "pointer",
  },
  batchButtons: {
    display: "flex",
    gap: "0.5rem",
    marginBottom: "1rem",
  },
  batchButton: {
    flex: 1,
    padding: "0.75rem",
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "#fff",
    backgroundColor: "#7c3aed",
    border: "none",
    borderRadius: "0.5rem",
    cursor: "pointer",
  },
  settleButton: {
    width: "100%",
    padding: "1rem",
    fontSize: "1rem",
    fontWeight: "600",
    color: "#fff",
    backgroundColor: "#10b981",
    border: "none",
    borderRadius: "0.5rem",
    cursor: "pointer",
    marginTop: "0.5rem",
  },
  loadingSpinner: {
    textAlign: "center",
    padding: "2rem",
    color: "#94a3b8",
  },
  settlementSummary: {
    display: "flex",
    justifyContent: "space-around",
    marginBottom: "1.5rem",
    padding: "1rem",
    backgroundColor: "#0f172a",
    borderRadius: "0.5rem",
  },
  summaryItem: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  summaryLabel: {
    color: "#94a3b8",
    fontSize: "0.75rem",
  },
  summaryValue: {
    fontSize: "1.25rem",
    fontWeight: "bold",
    color: "#fff",
  },
  summaryValueGreen: {
    fontSize: "1.25rem",
    fontWeight: "bold",
    color: "#10b981",
  },
  summaryValueRed: {
    fontSize: "1.25rem",
    fontWeight: "bold",
    color: "#ef4444",
  },
  gasComparison: {
    backgroundColor: "#0f172a",
    borderRadius: "0.5rem",
    padding: "1rem",
    marginBottom: "1.5rem",
  },
  comparisonTitle: {
    margin: "0 0 0.75rem 0",
    fontSize: "0.875rem",
    color: "#94a3b8",
  },
  comparisonRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "0.25rem 0",
    color: "#e2e8f0",
    fontSize: "0.875rem",
  },
  savingsRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "0.5rem 0",
    marginTop: "0.5rem",
    borderTop: "1px solid #1e293b",
    fontWeight: "600",
  },
  savings: {
    color: "#10b981",
  },
  eventLogs: {
    backgroundColor: "#0f172a",
    borderRadius: "0.5rem",
    padding: "1rem",
    marginBottom: "1.5rem",
  },
  logsTitle: {
    margin: "0 0 0.75rem 0",
    fontSize: "0.875rem",
    color: "#94a3b8",
  },
  logEntry: {
    fontSize: "0.75rem",
    color: "#10b981",
    padding: "0.25rem 0",
    fontFamily: "monospace",
  },
  logCard: {
    backgroundColor: "#1e293b",
    borderRadius: "0.75rem",
    padding: "1.5rem",
    marginBottom: "1rem",
    maxHeight: "400px",
    overflow: "hidden",
  },
  logTitle: {
    margin: "0 0 1rem 0",
    fontSize: "1rem",
    color: "#fff",
  },
  logContainer: {
    maxHeight: "300px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  logItem: {
    backgroundColor: "#0f172a",
    borderRadius: "0.5rem",
    padding: "0.75rem",
  },
  logItemHeader: {
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
    color: "#94a3b8",
  },
  logDescription: {
    margin: "0 0 0.5rem 0",
    fontSize: "0.875rem",
    color: "#e2e8f0",
  },
  logMeta: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "0.625rem",
    color: "#64748b",
    fontFamily: "monospace",
  },
  propertiesCard: {
    backgroundColor: "#1e293b",
    borderRadius: "0.75rem",
    padding: "1.5rem",
    marginTop: "2rem",
    border: "1px solid #3b82f6",
  },
  propertiesTitle: {
    margin: "0 0 1rem 0",
    fontSize: "1rem",
    color: "#3b82f6",
  },
  propertiesList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "0.5rem",
    fontSize: "0.875rem",
    color: "#94a3b8",
  },
  footer: {
    textAlign: "center",
    padding: "2rem",
    borderTop: "1px solid #1e293b",
    color: "#64748b",
    fontSize: "0.875rem",
  },
};
