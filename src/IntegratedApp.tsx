
import React, { useState, useCallback } from "react";
import { ethers } from "ethers";

// Real integrations
import {
  SessionFiClient,
  createSessionFiClientFromSigner,
} from "./unified";
import { RealLiFiRouter } from "./lifi/real-lifi-router";
import {
  RealSuiSettlementClient,
  type SuiSession,
  type CreateSessionResult,
} from "./sui";

// ============================================================================
// TYPES
// ============================================================================

interface AppState {
  connected: boolean;
  address: string;
  balance: string;
  chainId: number;
  networkName: string;

  // Session state
  session: SessionState | null;

  // Cross-chain state
  supportedChains: ChainInfo[];
  selectedFromChain: number;
  selectedToChain: number;

  // UI state
  loading: boolean;
  error: string | null;
  logs: LogEntry[];
}

interface SessionState {
  id: string;
  owner: string;
  balance: string;
  nonce: number;
  isActive: boolean;
  createdAt: number;
  expiresAt: number;
}

interface ChainInfo {
  id: number;
  name: string;
  nativeToken: string;
}

interface SuiCoin {
  objectId: string;
  balance: string;
  digest: string;
}

interface LogEntry {
  id: number;
  type: "info" | "success" | "error" | "warning";
  message: string;
  timestamp: number;
}

// ============================================================================
// DEPLOYED CONTRACT ADDRESSES
// ============================================================================

const DEPLOYED_CONTRACTS = {
  sepolia: {
    yellowCustodian: "0x187EDBb934591DF0f078076214e0564DB1c883A4",
    sessionFiHook: "0x73c44610f97f2560cD27c53370987B827DB30beA",
    chainId: 11155111,
  },
};

// ============================================================================
// MAIN APPLICATION
// ============================================================================

export default function IntegratedApp() {
  const [state, setState] = useState<AppState>({
    connected: false,
    address: "",
    balance: "0",
    chainId: 0,
    networkName: "",
    session: null,
    supportedChains: [],
    selectedFromChain: 1,
    selectedToChain: 42161,
    loading: false,
    error: null,
    logs: [],
  });

  const [client, setClient] = useState<SessionFiClient | null>(null);
  const [lifiRouter] = useState(() => new RealLiFiRouter());
  const logIdRef = React.useRef(0);
  const [suiClient, setSuiClient] =
    useState<RealSuiSettlementClient | null>(null);
  const [suiConfig, setSuiConfig] = useState({
    network: (import.meta as any)?.env?.VITE_SUI_NETWORK ||
      ("testnet" as "mainnet" | "testnet" | "devnet"),
    packageId: (import.meta as any)?.env?.VITE_SUI_PACKAGE_ID || "",
    privateKey: (import.meta as any)?.env?.VITE_SUI_PRIVATE_KEY || "",
    coinType: (import.meta as any)?.env?.VITE_SUI_COIN_TYPE || "0x2::sui::SUI",
  });
  const [suiAddress, setSuiAddress] = useState<string | null>(null);
  const [suiBalance, setSuiBalance] = useState<string>("0");
  const [suiCoins, setSuiCoins] = useState<SuiCoin[]>([]);
  const [selectedCoinId, setSelectedCoinId] = useState<string>("");
  const [suiSessionId, setSuiSessionId] = useState<string>("");
  const [suiSession, setSuiSession] = useState<SuiSession | null>(null);
  const [suiWithdrawAmount, setSuiWithdrawAmount] =
    useState<string>("");
  const [suiCreateResult, setSuiCreateResult] =
    useState<CreateSessionResult | null>(null);

  // ==========================================================================
  // LOGGING
  // ==========================================================================

  const addLog = useCallback((type: LogEntry["type"], message: string) => {
    setState((prev) => ({
      ...prev,
      logs: [
        {
          id: logIdRef.current++,
          type,
          message,
          timestamp: Date.now(),
        },
        ...prev.logs.slice(0, 49), // Keep last 50 logs
      ],
    }));
  }, []);

  // ==========================================================================
  // CONNECTION
  // ==========================================================================

  const connect = useCallback(async () => {
    const ethereum = (window as any)?.ethereum;
    if (!ethereum) {
      setState((prev) => ({
        ...prev,
        error:
          "No wallet detected. Install MetaMask or another EVM wallet to continue.",
      }));
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));
    addLog("info", "Connecting wallet...");

    try {
      const provider = new ethers.BrowserProvider(ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();

      const network = await provider.getNetwork();
      if (Number(network.chainId) !== DEPLOYED_CONTRACTS.sepolia.chainId) {
        try {
          await ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0xaa36a7" }], // Sepolia
          });
        } catch (switchError: any) {
          throw new Error(
            "Please switch your wallet to Sepolia testnet and try again.",
          );
        }
      }

      const newClient = createSessionFiClientFromSigner(signer);
      setClient(newClient);

      const [balance, networkInfo, address] = await Promise.all([
        newClient.getBalance(),
        newClient.getNetworkInfo(),
        newClient.getAddress(),
      ]);

      // Load supported chains from LI.FI
      const chains = await lifiRouter.getSupportedChains();

      setState((prev) => ({
        ...prev,
        connected: true,
        address,
        balance,
        chainId: networkInfo.chainId,
        networkName: networkInfo.name,
        supportedChains: chains.map((c: any) => ({
          id: c.id,
          name: c.name,
          nativeToken: c.nativeToken?.symbol || "ETH",
        })),
        loading: false,
      }));

      addLog("success", `Connected! Address: ${address}`);
      addLog("info", `Balance: ${balance} ETH`);
      addLog(
        "info",
        `Yellow Custodian: ${DEPLOYED_CONTRACTS.sepolia.yellowCustodian}`,
      );
      addLog(
        "info",
        `SessionFi Hook: ${DEPLOYED_CONTRACTS.sepolia.sessionFiHook}`,
      );
    } catch (error: any) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error.message,
      }));
      addLog("error", `Connection failed: ${error.message}`);
    }
  }, [lifiRouter, addLog]);

  // ==========================================================================
  // SESSION MANAGEMENT
  // ==========================================================================

  const createSession = useCallback(async () => {
    if (!client) return;

    setState((prev) => ({ ...prev, loading: true }));
    addLog("info", "Creating session on SessionFi Hook...");

    try {
      const result = await client.createHookSession(3600); // 1 hour

      addLog("success", `Session created: ${result.sessionId}`);
      addLog("info", `Transaction: ${result.txHash}`);

      // Fetch session details
      const session = await client.getHookSession(result.sessionId);

      setState((prev) => ({
        ...prev,
        session: {
          id: session.id,
          owner: session.owner,
          balance: session.balance,
          nonce: session.nonce,
          isActive: session.isActive,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt || 0,
        },
        loading: false,
      }));
    } catch (error: any) {
      setState((prev) => ({ ...prev, loading: false }));
      addLog("error", `Session creation failed: ${error.message}`);
    }
  }, [client, addLog]);

  const settleSession = useCallback(async () => {
    if (!client || !state.session) return;

    setState((prev) => ({ ...prev, loading: true }));
    addLog("info", "Settling session...");

    try {
      const result = await client.settleHookSession(state.session.id);

      addLog("success", `Session settled! Tx: ${result.txHash}`);

      setState((prev) => ({
        ...prev,
        session: null,
        loading: false,
      }));
    } catch (error: any) {
      setState((prev) => ({ ...prev, loading: false }));
      addLog("error", `Settlement failed: ${error.message}`);
    }
  }, [client, state.session, addLog]);

  // ==========================================================================
  // CROSS-CHAIN QUOTE
  // ==========================================================================

  const getCrossChainQuote = useCallback(async () => {
    if (!client) return;

    setState((prev) => ({ ...prev, loading: true }));
    addLog(
      "info",
      `Getting cross-chain quote ${state.selectedFromChain} → ${state.selectedToChain}...`,
    );

    try {
      const quote = await client.getCrossChainQuote({
        sessionId: state.session?.id || "demo",
        fromChainId: state.selectedFromChain,
        toChainId: state.selectedToChain,
        fromToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", // Native ETH
        toToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", // Native ETH
        amount: "1000000000000000", // 0.001 ETH
      });

      addLog("success", `Quote received!`);
      addLog("info", `Amount In: ${quote.amountIn}`);
      addLog("info", `Estimated Out: ${quote.estimatedAmountOut}`);
      addLog("info", `Gas Cost: $${quote.gasCost || "N/A"}`);
      addLog("info", `Duration: ${quote.duration || "N/A"}s`);

      setState((prev) => ({ ...prev, loading: false }));
    } catch (error: any) {
      setState((prev) => ({ ...prev, loading: false }));
      addLog("error", `Quote failed: ${error.message}`);
    }
  }, [
    client,
    state.selectedFromChain,
    state.selectedToChain,
    state.session,
    addLog,
  ]);

  // ==========================================================================
  // SUI SETTLEMENT (REAL CLIENT)
  // ==========================================================================

  const initSuiClient = useCallback(() => {
    if (!suiConfig.packageId) {
      addLog("warning", "Sui Package ID is required.");
      return;
    }

    const newClient = new RealSuiSettlementClient({
      network: suiConfig.network,
      packageId: suiConfig.packageId,
      privateKey: suiConfig.privateKey || undefined,
    });

    setSuiClient(newClient);
    const addr = newClient.getAddress();
    setSuiAddress(addr);
    addLog(
      "success",
      `Sui client initialized on ${newClient.getNetwork()}`,
    );
    if (!addr) {
      addLog(
        "warning",
        "Sui private key missing or invalid. Read-only calls only.",
      );
    }
  }, [suiConfig, addLog]);

  const refreshSuiBalance = useCallback(async () => {
    if (!suiClient) return;
    try {
      const balance = await suiClient.getBalance();
      setSuiBalance(balance);
      addLog("info", `Sui balance: ${balance}`);
    } catch (error: any) {
      addLog("error", `Sui balance error: ${error.message}`);
    }
  }, [suiClient, addLog]);

  const loadSuiCoins = useCallback(async () => {
    if (!suiClient) return;
    try {
      const coins = await suiClient.getOwnedCoins(suiConfig.coinType);
      setSuiCoins(coins);
      const first = coins[0]?.objectId || "";
      setSelectedCoinId(first);
      addLog(
        "info",
        `Loaded ${coins.length} coin object(s) for ${suiConfig.coinType}`,
      );
    } catch (error: any) {
      addLog("error", `Sui coins error: ${error.message}`);
    }
  }, [suiClient, suiConfig.coinType, addLog]);

  const createSuiSession = useCallback(async () => {
    if (!suiClient) return;
    if (!selectedCoinId) {
      addLog("warning", "Select a Sui coin object to create a session.");
      return;
    }

    try {
      const result = await suiClient.createSession(
        selectedCoinId,
        suiConfig.coinType,
        60 * 60 * 1000,
      );
      setSuiCreateResult(result);
      setSuiSessionId(result.sessionId);
      addLog("success", `Sui session created: ${result.sessionId}`);
      addLog("info", `Sui tx: ${result.digest}`);
    } catch (error: any) {
      addLog("error", `Sui create session failed: ${error.message}`);
    }
  }, [suiClient, selectedCoinId, suiConfig.coinType, addLog]);

  const fetchSuiSession = useCallback(async () => {
    if (!suiClient || !suiSessionId) return;
    try {
      const session = await suiClient.getSession(suiSessionId);
      setSuiSession(session);
      if (session) {
        addLog("info", `Sui session loaded: ${suiSessionId}`);
      } else {
        addLog("warning", "Sui session not found.");
      }
    } catch (error: any) {
      addLog("error", `Sui session fetch failed: ${error.message}`);
    }
  }, [suiClient, suiSessionId, addLog]);

  const settleSuiSession = useCallback(async () => {
    if (!suiClient || !suiSessionId) return;
    try {
      const finalStateHash = suiClient.createStateHash(
        suiSessionId,
        (suiSession?.nonce || 0) + 1,
        suiSession?.balance || "0",
        Date.now(),
      );

      const emptySig = new Uint8Array();
      const result = await suiClient.settleSession(
        suiSessionId,
        suiConfig.coinType,
        finalStateHash,
        emptySig,
        emptySig,
      );

      addLog("success", `Sui session settled: ${result.digest}`);
    } catch (error: any) {
      addLog("error", `Sui settlement failed: ${error.message}`);
    }
  }, [suiClient, suiSessionId, suiSession, suiConfig.coinType, addLog]);

  
  const forceCloseSuiSession = useCallback(async () => {
    if (!suiClient || !suiSessionId) return;
    try {
      const result = await suiClient.forceClose(
        suiSessionId,
        suiConfig.coinType,
      );
      addLog("success", `Sui force close: ${result.digest}`);
      addLog("info", `Returned: ${result.returnedAmount}`);
    } catch (error: any) {
      addLog("error", `Sui force close failed: ${error.message}`);
    }
  }, [suiClient, suiSessionId, suiConfig.coinType, addLog]);

  const withdrawFromSuiSession = useCallback(async () => {
    if (!suiClient || !suiSessionId) return;
    if (!suiWithdrawAmount) {
      addLog("warning", "Enter a withdraw amount.");
      return;
    }
    try {
      const amount = BigInt(suiWithdrawAmount);
      if (amount < 0n) {
        addLog("warning", "Withdraw amount must be positive.");
        return;
      }
      const result = await suiClient.withdrawFromSession(
        suiSessionId,
        suiConfig.coinType,
        amount,
      );
      addLog("success", `Sui withdraw: ${result.digest}`);
    } catch (error: any) {
      addLog("error", `Sui withdraw failed: ${error.message}`);
    }
  }, [suiClient, suiSessionId, suiConfig.coinType, suiWithdrawAmount, addLog]);

// ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>🔗 SessionFi Integrated Dashboard</h1>
        <p style={styles.subtitle}>
          Connected to real deployed contracts on Sepolia
        </p>
      </header>

      <main style={styles.main}>
        {/* Connection Status */}
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>
            {state.connected ? "🟢 Connected" : "🔴 Not Connected"}
          </h2>

          {!state.connected ? (
            <div>
              <p style={styles.warning}>
                ?? Connect your wallet. This is a testnet demo.
              </p>
              <button
                style={styles.primaryBtn}
                onClick={connect}
                disabled={state.loading}
              >
                {state.loading ? "Connecting..." : "Connect Wallet"}
              </button>
            </div>
          ) : (
            <div style={styles.connectionInfo}>
              <div style={styles.infoRow}>
                <span>Address:</span>
                <code>{state.address}</code>
              </div>
              <div style={styles.infoRow}>
                <span>Balance:</span>
                <span>{parseFloat(state.balance).toFixed(4)} ETH</span>
              </div>
              <div style={styles.infoRow}>
                <span>Network:</span>
                <span>
                  {state.networkName} ({state.chainId})
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Deployed Contracts */}
        {state.connected && (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>📜 Deployed Contracts</h2>
            <div style={styles.contractList}>
              <div style={styles.contractItem}>
                <span style={styles.contractLabel}>Yellow Custodian:</span>
                <a
                  href={`https://sepolia.etherscan.io/address/${DEPLOYED_CONTRACTS.sepolia.yellowCustodian}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.contractLink}
                >
                  {DEPLOYED_CONTRACTS.sepolia.yellowCustodian.slice(0, 10)}...
                </a>
              </div>
              <div style={styles.contractItem}>
                <span style={styles.contractLabel}>SessionFi Hook:</span>
                <a
                  href={`https://sepolia.etherscan.io/address/${DEPLOYED_CONTRACTS.sepolia.sessionFiHook}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.contractLink}
                >
                  {DEPLOYED_CONTRACTS.sepolia.sessionFiHook.slice(0, 10)}...
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Session Management */}
        {state.connected && (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>⚡ Session Management</h2>

            {!state.session ? (
              <button
                style={styles.primaryBtn}
                onClick={createSession}
                disabled={state.loading}
              >
                {state.loading ? "Creating..." : "Create Hook Session (1 hour)"}
              </button>
            ) : (
              <div>
                <div style={styles.sessionInfo}>
                  <div style={styles.infoRow}>
                    <span>Session ID:</span>
                    <code>{state.session.id.slice(0, 16)}...</code>
                  </div>
                  <div style={styles.infoRow}>
                    <span>Status:</span>
                    <span
                      style={{
                        color: state.session.isActive ? "#10b981" : "#ef4444",
                      }}
                    >
                      {state.session.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div style={styles.infoRow}>
                    <span>Nonce:</span>
                    <span>{state.session.nonce}</span>
                  </div>
                </div>
                <button
                  style={{ ...styles.primaryBtn, backgroundColor: "#10b981" }}
                  onClick={settleSession}
                  disabled={state.loading}
                >
                  {state.loading ? "Settling..." : "Settle Session"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Cross-Chain Quote (LI.FI) */}
        {state.connected && (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>🌉 Cross-Chain Quote (LI.FI)</h2>
            <div style={styles.chainSelectors}>
              <select
                style={styles.select}
                value={state.selectedFromChain}
                onChange={(e) =>
                  setState((prev) => ({
                    ...prev,
                    selectedFromChain: parseInt(e.target.value),
                  }))
                }
              >
                {state.supportedChains.slice(0, 20).map((chain) => (
                  <option key={chain.id} value={chain.id}>
                    {chain.name}
                  </option>
                ))}
              </select>
              <span style={styles.arrow}>→</span>
              <select
                style={styles.select}
                value={state.selectedToChain}
                onChange={(e) =>
                  setState((prev) => ({
                    ...prev,
                    selectedToChain: parseInt(e.target.value),
                  }))
                }
              >
                {state.supportedChains.slice(0, 20).map((chain) => (
                  <option key={chain.id} value={chain.id}>
                    {chain.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              style={{ ...styles.primaryBtn, backgroundColor: "#8b5cf6" }}
              onClick={getCrossChainQuote}
              disabled={state.loading}
            >
              {state.loading ? "Fetching..." : "Get Cross-Chain Quote"}
            </button>
          </div>
        )}

        {/* Sui Settlement (Real) */}
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Sui Settlement (Real)</h2>
          <div style={styles.suiConfig}>
            <label style={styles.inputLabel}>
              Network
              <select
                style={styles.select}
                value={suiConfig.network}
                onChange={(e) =>
                  setSuiConfig((prev) => ({
                    ...prev,
                    network: e.target.value as "mainnet" | "testnet" | "devnet",
                  }))
                }
              >
                <option value="testnet">testnet</option>
                <option value="devnet">devnet</option>
                <option value="mainnet">mainnet</option>
              </select>
            </label>
            <label style={styles.inputLabel}>
              Package ID
              <input
                style={styles.input}
                value={suiConfig.packageId}
                onChange={(e) =>
                  setSuiConfig((prev) => ({
                    ...prev,
                    packageId: e.target.value,
                  }))
                }
                placeholder="0x...package_id"
              />
            </label>
            <label style={styles.inputLabel}>
              Private Key (ed25519)
              <input
                style={styles.input}
                type="password"
                value={suiConfig.privateKey}
                onChange={(e) =>
                  setSuiConfig((prev) => ({
                    ...prev,
                    privateKey: e.target.value,
                  }))
                }
                placeholder="0x... or base64"
              />
            </label>
            <label style={styles.inputLabel}>
              Coin Type
              <input
                style={styles.input}
                value={suiConfig.coinType}
                onChange={(e) =>
                  setSuiConfig((prev) => ({
                    ...prev,
                    coinType: e.target.value,
                  }))
                }
                placeholder="0x2::sui::SUI"
              />
            </label>
          </div>

          <div style={styles.suiButtons}>
            <button style={styles.primaryBtn} onClick={initSuiClient}>
              Initialize Sui Client
            </button>
            <button
              style={{ ...styles.primaryBtn, backgroundColor: "#0ea5e9" }}
              onClick={refreshSuiBalance}
              disabled={!suiClient}
            >
              Get Sui Balance
            </button>
            <button
              style={{ ...styles.primaryBtn, backgroundColor: "#8b5cf6" }}
              onClick={loadSuiCoins}
              disabled={!suiClient}
            >
              Load Sui Coins
            </button>
          </div>

          <div style={styles.suiInfo}>
            <div style={styles.infoRow}>
              <span>Sui Address:</span>
              <code>{suiAddress || "Not set"}</code>
            </div>
            <div style={styles.infoRow}>
              <span>Sui Balance:</span>
              <span>{suiBalance}</span>
            </div>
          </div>

          <div style={styles.suiSession}>
            <label style={styles.inputLabel}>
              Coin Object
              <select
                style={styles.select}
                value={selectedCoinId}
                onChange={(e) => setSelectedCoinId(e.target.value)}
              >
                <option value="">Select coin object</option>
                {suiCoins.map((coin) => (
                  <option key={coin.objectId} value={coin.objectId}>
                    {coin.objectId.slice(0, 16)}... ({coin.balance})
                  </option>
                ))}
              </select>
            </label>
            <button
              style={{ ...styles.primaryBtn, backgroundColor: "#10b981" }}
              onClick={createSuiSession}
              disabled={!suiClient}
            >
              Create Sui Session
            </button>
            <label style={styles.inputLabel}>
              Withdraw Amount (base units)
              <input
                style={styles.input}
                value={suiWithdrawAmount}
                onChange={(e) => setSuiWithdrawAmount(e.target.value)}
                placeholder="1000000000"
              />
            </label>

            <label style={styles.inputLabel}>
              Session ID
              <input
                style={styles.input}
                value={suiSessionId}
                onChange={(e) => setSuiSessionId(e.target.value)}
                placeholder="0x...session_id"
              />
            </label>
            <div style={styles.suiButtons}>
              <button
                style={{ ...styles.primaryBtn, backgroundColor: "#14b8a6" }}
                onClick={fetchSuiSession}
                disabled={!suiClient || !suiSessionId}
              >
                Fetch Session
              </button>
              <button
                style={{ ...styles.primaryBtn, backgroundColor: "#f97316" }}
                onClick={settleSuiSession}
                disabled={!suiClient || !suiSessionId}
              >
                Settle Session
              </button>

              <button
                style={{ ...styles.primaryBtn, backgroundColor: "#ef4444" }}
                onClick={forceCloseSuiSession}
                disabled={!suiClient || !suiSessionId}
              >
                Force Close
              </button>
              <button
                style={{ ...styles.primaryBtn, backgroundColor: "#f59e0b" }}
                onClick={withdrawFromSuiSession}
                disabled={!suiClient || !suiSessionId}
              >
                Withdraw
              </button>
            </div>
            {suiCreateResult && (
              <div style={styles.suiResult}>
                <div>Created: {suiCreateResult.sessionId}</div>
                <div>Expires: {suiCreateResult.expiresAt}</div>
                <div>Digest: {suiCreateResult.digest}</div>
              </div>
            )}
            {suiSession && (
              <div style={styles.suiResult}>
                <div>Active: {suiSession.isActive ? "Yes" : "No"}</div>
                <div>Nonce: {suiSession.nonce}</div>
                <div>Balance: {suiSession.balance}</div>
                <div>Expires: {suiSession.expiresAt}</div>
              </div>
            )}
          </div>
        </div>

        {/* Error Display */}
        {state.error && (
          <div style={styles.errorCard}>
            <p>{state.error}</p>
            <button
              style={styles.dismissBtn}
              onClick={() => setState((prev) => ({ ...prev, error: null }))}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Activity Log */}
        <div style={styles.logCard}>
          <h2 style={styles.cardTitle}>📋 Activity Log</h2>
          <div style={styles.logContainer}>
            {state.logs.length === 0 ? (
              <p style={styles.emptyLog}>No activity yet</p>
            ) : (
              state.logs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    ...styles.logEntry,
                    borderLeft: `3px solid ${
                      log.type === "success"
                        ? "#10b981"
                        : log.type === "error"
                          ? "#ef4444"
                          : log.type === "warning"
                            ? "#f59e0b"
                            : "#3b82f6"
                    }`,
                  }}
                >
                  <span style={styles.logTime}>
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <span style={styles.logMessage}>{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div style={styles.summaryCard}>
          <h2 style={styles.cardTitle}>Integrations</h2>
          <div style={styles.statusGrid}>
            <div style={styles.statusItem}>
              <span style={styles.statusIcon}>✅</span>
              <span>Yellow Network (Deployed)</span>
            </div>
            <div style={styles.statusItem}>
              <span style={styles.statusIcon}>✅</span>
              <span>LI.FI SDK (Integrated)</span>
            </div>
            <div style={styles.statusItem}>
              <span style={styles.statusIcon}>✅</span>
              <span>Uniswap v4 Hook (Deployed)</span>
            </div>
            <div style={styles.statusItem}>
              <span style={styles.statusIcon}>⏳</span>
              <span>Sui Settlement (Wired)</span>
            </div>
          </div>
        </div>
      </main>

      <footer style={styles.footer}>
        <p>SessionFi Protocol - Gasless DeFi Sessions</p>
      </footer>
    </div>
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
    background: "linear-gradient(135deg, #1e40af 0%, #7c3aed 100%)",
  },
  title: {
    fontSize: "2rem",
    fontWeight: "bold",
    margin: 0,
  },
  subtitle: {
    margin: "0.5rem 0 0",
    color: "#c7d2fe",
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
  warning: {
    color: "#f59e0b",
    fontSize: "0.875rem",
    marginBottom: "1rem",
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
  connectionInfo: {
    backgroundColor: "#0f172a",
    borderRadius: "0.5rem",
    padding: "1rem",
  },
  infoRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "0.5rem 0",
    borderBottom: "1px solid #1e293b",
  },
  contractList: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  contractItem: {
    display: "flex",
    justifyContent: "space-between",
    padding: "0.75rem",
    backgroundColor: "#0f172a",
    borderRadius: "0.5rem",
  },
  contractLabel: {
    color: "#94a3b8",
  },
  contractLink: {
    color: "#3b82f6",
    textDecoration: "none",
  },
  sessionInfo: {
    backgroundColor: "#0f172a",
    borderRadius: "0.5rem",
    padding: "1rem",
    marginBottom: "1rem",
  },
  chainSelectors: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    marginBottom: "1rem",
  },
  select: {
    flex: 1,
    padding: "0.75rem",
    fontSize: "1rem",
    backgroundColor: "#0f172a",
    color: "#e2e8f0",
    border: "1px solid #334155",
    borderRadius: "0.5rem",
  },
  inputLabel: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    fontSize: "0.875rem",
    color: "#cbd5f5",
  },
  input: {
    padding: "0.75rem",
    fontSize: "0.95rem",
    backgroundColor: "#0f172a",
    color: "#e2e8f0",
    border: "1px solid #334155",
    borderRadius: "0.5rem",
  },
  suiConfig: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "0.75rem",
    marginBottom: "1rem",
  },
  suiButtons: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "0.75rem",
    marginBottom: "1rem",
  },
  suiInfo: {
    backgroundColor: "#0f172a",
    borderRadius: "0.5rem",
    padding: "1rem",
    marginBottom: "1rem",
  },
  suiSession: {
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
  },
  suiResult: {
    backgroundColor: "#0b1220",
    borderRadius: "0.5rem",
    padding: "0.75rem",
    color: "#cbd5f5",
    fontSize: "0.875rem",
  },
  arrow: {
    fontSize: "1.5rem",
    color: "#94a3b8",
  },
  errorCard: {
    backgroundColor: "#7f1d1d",
    borderRadius: "0.5rem",
    padding: "1rem",
    marginBottom: "1rem",
  },
  dismissBtn: {
    marginTop: "0.5rem",
    padding: "0.5rem 1rem",
    backgroundColor: "#ef4444",
    color: "#fff",
    border: "none",
    borderRadius: "0.25rem",
    cursor: "pointer",
  },
  logCard: {
    backgroundColor: "#1e293b",
    borderRadius: "0.75rem",
    padding: "1.5rem",
    marginBottom: "1rem",
  },
  logContainer: {
    maxHeight: "300px",
    overflowY: "auto",
  },
  emptyLog: {
    color: "#64748b",
    textAlign: "center",
  },
  logEntry: {
    display: "flex",
    gap: "1rem",
    padding: "0.5rem",
    marginBottom: "0.25rem",
    backgroundColor: "#0f172a",
    borderRadius: "0.25rem",
  },
  logTime: {
    color: "#64748b",
    fontSize: "0.75rem",
    minWidth: "80px",
  },
  logMessage: {
    fontSize: "0.875rem",
  },
  summaryCard: {
    backgroundColor: "#1e293b",
    borderRadius: "0.75rem",
    padding: "1.5rem",
    border: "1px solid #3b82f6",
  },
  statusGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "0.75rem",
  },
  statusItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.75rem",
    backgroundColor: "#0f172a",
    borderRadius: "0.5rem",
  },
  statusIcon: {
    fontSize: "1.25rem",
  },
  footer: {
    textAlign: "center",
    padding: "2rem",
    borderTop: "1px solid #1e293b",
    color: "#64748b",
  },
};

