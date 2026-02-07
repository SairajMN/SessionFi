/**
 * SessionFi Unified Client
 *
 * A unified API that connects all SessionFi components:
 * - Yellow Network (EVM State Channels)
 * - LI.FI (Cross-Chain Routing)
 * - Uniswap v4 Hooks (AMM Integration)
 * - Sui Settlement (Multi-Chain)
 */

import { ethers } from "ethers";
import { RealLiFiRouter } from "../lifi/real-lifi-router";
import { SessionFiHookClient } from "../hooks/sessionfi-hook-client";

// ============================================================================
// TYPES
// ============================================================================

export interface SessionFiConfig {
  // EVM Configuration
  rpcUrl?: string;
  privateKey?: string;
  signer?: ethers.Signer;
  provider?: ethers.Provider;

  // Contract Addresses
  yellowCustodianAddress: string;
  sessionFiHookAddress: string;

  // Optional Sui Configuration
  suiNetwork?: "mainnet" | "testnet" | "devnet";
  suiPackageId?: string;
  suiPrivateKey?: string;
}

export interface Session {
  id: string;
  type: "yellow" | "hook" | "sui";
  owner: string;
  balance: string;
  nonce: number;
  isActive: boolean;
  createdAt: number;
  expiresAt?: number;
  network: string;
  chainId: number;
}

export interface SwapParams {
  sessionId: string;
  fromToken: string;
  toToken: string;
  amount: string;
  minAmountOut?: string;
  deadline?: number;
}

export interface CrossChainSwapParams {
  sessionId: string;
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
  amount: string;
  slippage?: number;
}

export interface SwapResult {
  success: boolean;
  txHash: string;
  amountIn: string;
  amountOut: string;
  fee?: string;
}

export interface QuoteResult {
  amountIn: string;
  estimatedAmountOut: string;
  minAmountOut: string;
  gasCost?: string;
  bridgeFee?: string;
  duration?: number;
  route?: any;
}

// ============================================================================
// SESSIONFI UNIFIED CLIENT
// ============================================================================

/**
 * SessionFiClient - Unified API for all SessionFi operations
 */
export class SessionFiClient {
  private provider: ethers.Provider;
  private signer: ethers.Signer;
  private lifiRouter: RealLiFiRouter;
  private hookClient: SessionFiHookClient;
  private config: SessionFiConfig;

  // Deployed contract addresses
  public static readonly DEPLOYED_CONTRACTS = {
    sepolia: {
      yellowCustodian: "0x187EDBb934591DF0f078076214e0564DB1c883A4",
      sessionFiHook: "0x73c44610f97f2560cD27c53370987B827DB30beA",
    },
  };

  constructor(config: SessionFiConfig) {
    this.config = config;
    if (config.signer) {
      this.signer = config.signer;
      let provider =
        this.signer.provider ||
        config.provider ||
        (config.rpcUrl ? new ethers.JsonRpcProvider(config.rpcUrl) : null);
      if (!provider) {
        throw new Error(
          "Provider required when using a signer without an attached provider.",
        );
      }
      this.provider = provider;
    } else {
      if (!config.privateKey) {
        throw new Error("Private key required when no signer is provided.");
      }
      const rpcUrl =
        config.rpcUrl ||
        process.env.SEPOLIA_RPC_URL ||
        "https://eth-sepolia.g.alchemy.com/v2/demo";
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      this.signer = new ethers.Wallet(config.privateKey, this.provider);
    }
    this.lifiRouter = new RealLiFiRouter();
    this.hookClient = new SessionFiHookClient(
      config.sessionFiHookAddress,
      this.signer,
    );

    console.log(`[SessionFi] Client initialized`);
    console.log(
      `[SessionFi] Yellow Custodian: ${config.yellowCustodianAddress}`,
    );
    console.log(`[SessionFi] SessionFi Hook: ${config.sessionFiHookAddress}`);
  }

  // ==========================================================================
  // SESSION MANAGEMENT
  // ==========================================================================

  /**
   * Create a new session using SessionFi Hook
   */
  async createHookSession(
    durationSeconds: number,
  ): Promise<{ sessionId: string; txHash: string }> {
    console.log(
      `[SessionFi] Creating Hook session with duration ${durationSeconds}s...`,
    );

    const result = await this.hookClient.createSession(durationSeconds);

    console.log(`[SessionFi] Hook session created: ${result.sessionId}`);

    return {
      sessionId: result.sessionId,
      txHash: result.txHash,
    };
  }

  /**
   * Deposit tokens into a Hook session
   */
  async depositToHookSession(
    sessionId: string,
    tokenAddress: string,
    amount: bigint,
  ): Promise<{ txHash: string }> {
    console.log(`[SessionFi] Depositing ${amount} to Hook session...`);

    const result = await this.hookClient.depositToSession(
      sessionId,
      tokenAddress,
      amount,
    );

    return { txHash: result.txHash };
  }

  /**
   * Get session details
   */
  async getHookSession(sessionId: string): Promise<Session> {
    const session = await this.hookClient.getSession(sessionId);

    return {
      id: sessionId,
      type: "hook",
      owner: session.owner,
      balance: session.availableAmount,
      nonce: session.nonce,
      isActive: session.isActive,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      network: "sepolia",
      chainId: 11155111,
    };
  }

  /**
   * Settle a Hook session
   */
  async settleHookSession(sessionId: string): Promise<{ txHash: string }> {
    console.log(`[SessionFi] Settling Hook session ${sessionId}...`);

    const result = await this.hookClient.settleSession(sessionId);

    console.log(`[SessionFi] Session settled: ${result.txHash}`);

    return { txHash: result.txHash };
  }

  // ==========================================================================
  // SAME-CHAIN SWAPS (via Hook)
  // ==========================================================================

  /**
   * Execute a swap within a Hook session
   */
  async executeSwap(params: SwapParams): Promise<SwapResult> {
    console.log(`[SessionFi] Executing swap in session ${params.sessionId}...`);

    const intent = this.hookClient.createIntent(
      params.sessionId,
      params.fromToken,
      params.toToken,
      BigInt(params.amount),
      params.minAmountOut ? BigInt(params.minAmountOut) : BigInt(0),
      params.deadline,
    );

    const result = await this.hookClient.executeSwapIntent(intent);

    return {
      success: result.success,
      txHash: result.txHash,
      amountIn: result.amountIn,
      amountOut: result.amountOut,
      fee: result.fee,
    };
  }

  // ==========================================================================
  // CROSS-CHAIN SWAPS (via LI.FI)
  // ==========================================================================

  /**
   * Get a quote for a cross-chain swap
   */
  async getCrossChainQuote(params: CrossChainSwapParams): Promise<QuoteResult> {
    console.log(
      `[SessionFi] Getting cross-chain quote ${params.fromChainId} -> ${params.toChainId}...`,
    );

    const fromAddress = await this.getAddress();
    const quoteResult = await this.lifiRouter.getRoutes({
      fromChainId: params.fromChainId,
      toChainId: params.toChainId,
      fromTokenAddress: params.fromToken,
      toTokenAddress: params.toToken,
      fromAmount: params.amount,
      fromAddress,
    });

    if (
      !quoteResult ||
      !quoteResult.routes ||
      quoteResult.routes.length === 0
    ) {
      throw new Error("No routes found");
    }

    const bestRoute = quoteResult.routes[0];

    return {
      amountIn: params.amount,
      estimatedAmountOut: bestRoute.toAmount || "0",
      minAmountOut: bestRoute.toAmountMin || "0",
      gasCost: bestRoute.gasCostUSD,
      bridgeFee: (bestRoute as any).feeCosts?.[0]?.amountUSD,
      duration:
        bestRoute.steps?.reduce(
          (acc: number, s: any) => acc + (s.estimate?.executionDuration || 0),
          0,
        ) || 0,
      route: bestRoute,
    };
  }

  /**
   * Get supported chains for cross-chain swaps
   */
  async getSupportedChains(): Promise<
    Array<{ id: number; name: string; nativeToken: string }>
  > {
    const chains = await this.lifiRouter.getSupportedChains();
    return chains.map((c: any) => ({
      id: c.id,
      name: c.name,
      nativeToken: c.nativeToken?.symbol || "ETH",
    }));
  }

  /**
   * Get tokens available on a chain
   */
  async getTokensOnChain(
    chainId: number,
  ): Promise<Array<{ address: string; symbol: string; decimals: number }>> {
    const tokens = await this.lifiRouter.getTokensForChain(chainId);
    return tokens.slice(0, 20).map((t: any) => ({
      address: t.address,
      symbol: t.symbol,
      decimals: t.decimals,
    }));
  }

  // ==========================================================================
  // UTILITY FUNCTIONS
  // ==========================================================================

  /**
   * Get signer address
   */
  async getAddress(): Promise<string> {
    return this.signer.getAddress();
  }

  /**
   * Get ETH balance
   */
  async getBalance(): Promise<string> {
    const address = await this.getAddress();
    const balance = await this.provider.getBalance(address);
    return ethers.formatEther(balance);
  }

  /**
   * Get token balance
   */
  async getTokenBalance(tokenAddress: string): Promise<string> {
    const token = new ethers.Contract(
      tokenAddress,
      ["function balanceOf(address) view returns (uint256)"],
      this.provider,
    );
    const address = await this.getAddress();
    const balance = await token.balanceOf(address);
    return balance.toString();
  }

  /**
   * Get network info
   */
  async getNetworkInfo(): Promise<{ name: string; chainId: number }> {
    const network = await this.provider.getNetwork();
    return {
      name: network.name,
      chainId: Number(network.chainId),
    };
  }

  /**
   * Check if session is valid (active and not expired)
   */
  async isSessionValid(sessionId: string): Promise<boolean> {
    return this.hookClient.isSessionValid(sessionId);
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a SessionFi client with default Sepolia configuration
 */
export function createSessionFiClient(
  privateKey: string,
  rpcUrl?: string,
): SessionFiClient {
  return new SessionFiClient({
    rpcUrl,
    privateKey,
    yellowCustodianAddress:
      SessionFiClient.DEPLOYED_CONTRACTS.sepolia.yellowCustodian,
    sessionFiHookAddress:
      SessionFiClient.DEPLOYED_CONTRACTS.sepolia.sessionFiHook,
  });
}

/**
 * Create a SessionFi client from an injected wallet signer
 */
export function createSessionFiClientFromSigner(
  signer: ethers.Signer,
  rpcUrl?: string,
): SessionFiClient {
  return new SessionFiClient({
    signer,
    rpcUrl,
    yellowCustodianAddress:
      SessionFiClient.DEPLOYED_CONTRACTS.sepolia.yellowCustodian,
    sessionFiHookAddress:
      SessionFiClient.DEPLOYED_CONTRACTS.sepolia.sessionFiHook,
  });
}

// ============================================================================
// EXPORTS
// ============================================================================

export default SessionFiClient;
