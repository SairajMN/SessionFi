/**
 * Real Sui Settlement Client
 *
 * TypeScript client for interacting with the SessionFi Move contract on Sui.
 */

import { getJsonRpcFullnodeUrl, SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromHex, toHex } from "@mysten/bcs";

// Browser-safe base64 decoder with Node fallback
const decodePrivateKey = (key: string): Uint8Array => {
  // Hex-encoded key
  if (key.startsWith("0x")) {
    return fromHex(key as `0x${string}`);
  }

  // Browser: use atob to avoid Node Buffer dependency
  if (typeof atob === "function") {
    const binary = atob(key);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  // Node/testing fallback if Buffer exists
  const maybeBuffer = (globalThis as any)?.Buffer;
  if (maybeBuffer && typeof maybeBuffer.from === "function") {
    return maybeBuffer.from(key, "base64");
  }

  throw new Error("Unsupported runtime: cannot decode base64 private key");
};

// ============================================================================
// TYPES
// ============================================================================

export interface SuiConfig {
  network: "mainnet" | "testnet" | "devnet";
  packageId: string;
  privateKey?: string;
}

export interface SuiSession {
  sessionId: string;
  owner: string;
  balance: string;
  nonce: number;
  stateHash: string;
  createdAt: number;
  expiresAt: number;
  isActive: boolean;
  totalVolume: string;
}

export interface CreateSessionResult {
  sessionId: string;
  digest: string;
  owner: string;
  amount: string;
  expiresAt: number;
}

export interface SettleSessionResult {
  digest: string;
  finalAmount: string;
  finalNonce: number;
}

// ============================================================================
// SUI SETTLEMENT CLIENT
// ============================================================================

/**
 * RealSuiSettlementClient - Production-ready Sui integration
 */
export class RealSuiSettlementClient {
  private client: SuiJsonRpcClient;
  private keypair: Ed25519Keypair | null = null;
  private packageId: string;
  private network: string;

  constructor(config: SuiConfig) {
    this.network = config.network;
    this.client = new SuiJsonRpcClient({
      url: getJsonRpcFullnodeUrl(config.network),
      network: config.network,
    });
    this.packageId = config.packageId;

    if (config.privateKey) {
      // Support both hex and base64 formats
      try {
        const keyBytes = decodePrivateKey(config.privateKey);
        this.keypair = Ed25519Keypair.fromSecretKey(keyBytes);
      } catch (error) {
        console.warn("[Sui] Could not parse private key:", error);
      }
    }

    console.log(`[Sui] Client initialized on ${config.network}`);
    console.log(`[Sui] Package ID: ${config.packageId}`);
    if (this.keypair) {
      console.log(`[Sui] Address: ${this.keypair.toSuiAddress()}`);
    }
  }

  // ==========================================================================
  // SESSION MANAGEMENT
  // ==========================================================================

  /**
   * Create a new trading session
   */
  async createSession(
    coinObjectId: string,
    coinType: string,
    durationMs: number,
  ): Promise<CreateSessionResult> {
    if (!this.keypair) {
      throw new Error("Private key required for transactions");
    }

    console.log(`[Sui] Creating session with duration ${durationMs}ms...`);

    const tx = new Transaction();

    tx.moveCall({
      target: `${this.packageId}::settlement::create_session`,
      typeArguments: [coinType],
      arguments: [
        tx.object(coinObjectId),
        tx.pure.u64(durationMs),
        tx.object("0x6"), // Clock object ID on Sui
      ],
    });

    const result = await this.client.signAndExecuteTransaction({
      transaction: tx,
      signer: this.keypair,
      options: {
        showEvents: true,
        showEffects: true,
        showObjectChanges: true,
      },
    });

    // Find SessionCreated event
    const createEvent = result.events?.find((e) =>
      e.type.includes("SessionCreated"),
    );

    const eventData = createEvent?.parsedJson as any;

    console.log(`[Sui] Session created: ${eventData?.session_id}`);
    console.log(`[Sui] Transaction digest: ${result.digest}`);

    return {
      sessionId: eventData?.session_id || "",
      digest: result.digest,
      owner: eventData?.owner || "",
      amount: eventData?.amount?.toString() || "0",
      expiresAt: Number(eventData?.expires_at) || 0,
    };
  }

  /**
   * Deposit additional funds into a session
   */
  async depositToSession(
    sessionObjectId: string,
    coinObjectId: string,
    coinType: string,
  ): Promise<{ digest: string }> {
    if (!this.keypair) {
      throw new Error("Private key required for transactions");
    }

    console.log(`[Sui] Depositing to session ${sessionObjectId}...`);

    const tx = new Transaction();

    tx.moveCall({
      target: `${this.packageId}::settlement::deposit_to_session`,
      typeArguments: [coinType],
      arguments: [
        tx.object(sessionObjectId),
        tx.object(coinObjectId),
        tx.object("0x6"),
      ],
    });

    const result = await this.client.signAndExecuteTransaction({
      transaction: tx,
      signer: this.keypair,
      options: { showEffects: true },
    });

    console.log(`[Sui] Deposit complete: ${result.digest}`);

    return { digest: result.digest };
  }

  /**
   * Update session state (for off-chain state sync)
   */
  async updateState(
    sessionObjectId: string,
    coinType: string,
    newNonce: number,
    stateHash: Uint8Array,
    volumeDelta: number,
  ): Promise<{ digest: string }> {
    if (!this.keypair) {
      throw new Error("Private key required for transactions");
    }

    console.log(`[Sui] Updating session state, nonce: ${newNonce}...`);

    const tx = new Transaction();

    tx.moveCall({
      target: `${this.packageId}::settlement::update_state`,
      typeArguments: [coinType],
      arguments: [
        tx.object(sessionObjectId),
        tx.pure.u64(newNonce),
        tx.pure.vector("u8", Array.from(stateHash)),
        tx.pure.u64(volumeDelta),
        tx.object("0x6"),
      ],
    });

    const result = await this.client.signAndExecuteTransaction({
      transaction: tx,
      signer: this.keypair,
      options: { showEffects: true, showEvents: true },
    });

    console.log(`[Sui] State updated: ${result.digest}`);

    return { digest: result.digest };
  }

  /**
   * Settle session with final state proof
   */
  async settleSession(
    sessionObjectId: string,
    coinType: string,
    finalStateHash: Uint8Array,
    userSignature: Uint8Array,
    engineSignature: Uint8Array,
  ): Promise<SettleSessionResult> {
    if (!this.keypair) {
      throw new Error("Private key required for transactions");
    }

    console.log(`[Sui] Settling session ${sessionObjectId}...`);

    const tx = new Transaction();

    tx.moveCall({
      target: `${this.packageId}::settlement::settle_session`,
      typeArguments: [coinType],
      arguments: [
        tx.object(sessionObjectId),
        tx.pure.vector("u8", Array.from(finalStateHash)),
        tx.pure.vector("u8", Array.from(userSignature)),
        tx.pure.vector("u8", Array.from(engineSignature)),
        tx.object("0x6"),
      ],
    });

    const result = await this.client.signAndExecuteTransaction({
      transaction: tx,
      signer: this.keypair,
      options: { showEvents: true, showEffects: true },
    });

    // Find SessionSettled event
    const settleEvent = result.events?.find((e) =>
      e.type.includes("SessionSettled"),
    );

    const eventData = settleEvent?.parsedJson as any;

    console.log(`[Sui] Session settled: ${result.digest}`);

    return {
      digest: result.digest,
      finalAmount: eventData?.final_amount?.toString() || "0",
      finalNonce: Number(eventData?.final_nonce) || 0,
    };
  }

  /**
   * Force close an expired session
   */
  async forceClose(
    sessionObjectId: string,
    coinType: string,
  ): Promise<{ digest: string; returnedAmount: string }> {
    if (!this.keypair) {
      throw new Error("Private key required for transactions");
    }

    console.log(`[Sui] Force closing session ${sessionObjectId}...`);

    const tx = new Transaction();

    tx.moveCall({
      target: `${this.packageId}::settlement::force_close`,
      typeArguments: [coinType],
      arguments: [tx.object(sessionObjectId), tx.object("0x6")],
    });

    const result = await this.client.signAndExecuteTransaction({
      transaction: tx,
      signer: this.keypair,
      options: { showEvents: true, showEffects: true },
    });

    const closeEvent = result.events?.find((e) =>
      e.type.includes("SessionForceClosed"),
    );

    const eventData = closeEvent?.parsedJson as any;

    console.log(`[Sui] Session force closed: ${result.digest}`);

    return {
      digest: result.digest,
      returnedAmount: eventData?.returned_amount?.toString() || "0",
    };
  }

  /**
   * Withdraw partial amount from session
   */
  async withdrawFromSession(
    sessionObjectId: string,
    coinType: string,
    amount: bigint,
  ): Promise<{ digest: string }> {
    if (!this.keypair) {
      throw new Error("Private key required for transactions");
    }

    console.log(`[Sui] Withdrawing ${amount} from session...`);

    const tx = new Transaction();

    tx.moveCall({
      target: `${this.packageId}::settlement::withdraw_from_session`,
      typeArguments: [coinType],
      arguments: [
        tx.object(sessionObjectId),
        tx.pure.u64(amount),
        tx.object("0x6"),
      ],
    });

    const result = await this.client.signAndExecuteTransaction({
      transaction: tx,
      signer: this.keypair,
      options: { showEffects: true },
    });

    console.log(`[Sui] Withdrawal complete: ${result.digest}`);

    return { digest: result.digest };
  }

  // ==========================================================================
  // VIEW FUNCTIONS
  // ==========================================================================

  /**
   * Get session details
   */
  async getSession(sessionObjectId: string): Promise<SuiSession | null> {
    try {
      const object = await this.client.getObject({
        id: sessionObjectId,
        options: { showContent: true, showType: true },
      });

      if (object.data?.content?.dataType !== "moveObject") {
        return null;
      }

      const fields = (object.data.content as any).fields;

      return {
        sessionId: sessionObjectId,
        owner: fields.owner,
        balance: fields.locked_balance?.toString() || "0",
        nonce: Number(fields.nonce) || 0,
        stateHash: toHex(new Uint8Array(fields.state_hash || [])),
        createdAt: Number(fields.created_at) || 0,
        expiresAt: Number(fields.expires_at) || 0,
        isActive: fields.is_active || false,
        totalVolume: fields.total_volume?.toString() || "0",
      };
    } catch (error) {
      console.error(`[Sui] Error fetching session:`, error);
      return null;
    }
  }

  /**
   * Get user's SUI balance
   */
  async getBalance(address?: string): Promise<string> {
    const addr = address || this.keypair?.toSuiAddress();
    if (!addr) {
      throw new Error("Address required");
    }

    const balance = await this.client.getBalance({
      owner: addr,
    });

    return balance.totalBalance;
  }

  /**
   * Get owned coins of a specific type
   */
  async getOwnedCoins(
    coinType: string,
    address?: string,
  ): Promise<Array<{ objectId: string; balance: string; digest: string }>> {
    const addr = address || this.keypair?.toSuiAddress();
    if (!addr) {
      throw new Error("Address required");
    }

    const coins = await this.client.getCoins({
      owner: addr,
      coinType,
    });

    return coins.data.map((coin) => ({
      objectId: coin.coinObjectId,
      balance: coin.balance,
      digest: coin.digest,
    }));
  }

  /**
   * Get current address
   */
  getAddress(): string | null {
    return this.keypair?.toSuiAddress() || null;
  }

  /**
   * Get network
   */
  getNetwork(): string {
    return this.network;
  }

  /**
   * Get package ID
   */
  getPackageId(): string {
    return this.packageId;
  }

  // ==========================================================================
  // UTILITY FUNCTIONS
  // ==========================================================================

  /**
   * Create state hash from session data
   */
  createStateHash(
    sessionId: string,
    nonce: number,
    balance: string,
    timestamp: number,
  ): Uint8Array {
    const data = `${sessionId}:${nonce}:${balance}:${timestamp}`;
    // Simple hash using TextEncoder - in production use proper crypto
    const encoder = new TextEncoder();
    const bytes = encoder.encode(data);
    // Return first 32 bytes or pad
    const hash = new Uint8Array(32);
    hash.set(bytes.slice(0, 32));
    return hash;
  }

  /**
   * Sign message with keypair
   */
  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!this.keypair) {
      throw new Error("Private key required for signing");
    }

    const signature = await this.keypair.signPersonalMessage(message);
    return signature.signature;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a Sui settlement client from environment variables
 */
export function createSuiClient(
  network: "mainnet" | "testnet" | "devnet" = "testnet",
): RealSuiSettlementClient {
  const packageId = process.env.SUI_PACKAGE_ID || "0x0";
  const privateKey = process.env.SUI_PRIVATE_KEY;

  return new RealSuiSettlementClient({
    network,
    packageId,
    privateKey,
  });
}

// ============================================================================
// EXPORTS
// ============================================================================

export default RealSuiSettlementClient;
