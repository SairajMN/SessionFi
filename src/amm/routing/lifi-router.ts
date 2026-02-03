/**
 * LI.FI Cross-Chain Routing Integration
 *
 * Provides cross-DEX and cross-chain routing capabilities for AMM sessions.
 * Integrates with LI.FI aggregator for optimal path finding across chains.
 *
 * Key Features:
 * - Cross-chain intent execution
 * - Multi-DEX aggregation
 * - Bridge selection optimization
 * - Gas estimation across chains
 */

import {
  Token,
  RouteSegment,
  CrossDexSwapIntent,
  IntentType,
  IntentStatus,
  AMMSession,
} from "../types";
import { hashStringSync } from "../../crypto/browser-primitives";

// ============================================================================
// LIFI TYPES
// ============================================================================

/**
 * Supported chains for cross-chain swaps
 */
export enum SupportedChain {
  ETHEREUM = 1,
  POLYGON = 137,
  ARBITRUM = 42161,
  OPTIMISM = 10,
  BSC = 56,
  AVALANCHE = 43114,
  BASE = 8453,
  SUI = 101, // Placeholder for Sui chain ID
}

/**
 * Supported bridges for cross-chain transfers
 */
export enum Bridge {
  STARGATE = "stargate",
  HOP = "hop",
  ACROSS = "across",
  CBRIDGE = "cbridge",
  WORMHOLE = "wormhole",
  LAYERZERO = "layerzero",
}

/**
 * LI.FI route response
 */
export interface LiFiRoute {
  routeId: string;
  fromChainId: number;
  toChainId: number;
  fromToken: Token;
  toToken: Token;
  fromAmount: bigint;
  toAmount: bigint;
  steps: LiFiStep[];
  estimatedDuration: number; // seconds
  estimatedGas: bigint;
  bridgeFee: bigint;
  priceImpact: number;
  tags: string[];
}

/**
 * Single step in LI.FI route
 */
export interface LiFiStep {
  stepId: number;
  type: "SWAP" | "BRIDGE" | "APPROVE";
  protocol: string;
  chainId: number;
  fromToken: string;
  toToken: string;
  fromAmount: bigint;
  toAmount: bigint;
  estimatedGas: bigint;
  bridgeData?: BridgeData;
}

/**
 * Bridge-specific data
 */
export interface BridgeData {
  bridge: Bridge;
  srcChainId: number;
  dstChainId: number;
  sendingAsset: string;
  receivingAsset: string;
  amount: bigint;
  fee: bigint;
  estimatedTime: number;
}

/**
 * Quote request parameters
 */
export interface LiFiQuoteRequest {
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
  fromAmount: bigint;
  fromAddress: string;
  toAddress?: string;
  slippage: number;
  integrator?: string;
  preferredBridges?: Bridge[];
  excludedBridges?: Bridge[];
}

/**
 * Route optimization preferences
 */
export interface RoutePreferences {
  priority: "FASTEST" | "CHEAPEST" | "SAFEST";
  maxBridges: number;
  maxSteps: number;
  allowedBridges?: Bridge[];
  excludedBridges?: Bridge[];
}

// ============================================================================
// LIFI ROUTER
// ============================================================================

/**
 * LiFiRouter handles cross-chain and cross-DEX routing
 */
export class LiFiRouter {
  private apiBaseUrl: string;
  private integratorId: string;
  private cachedRoutes: Map<string, LiFiRoute[]> = new Map();
  private supportedTokens: Map<number, Token[]> = new Map();

  constructor(
    apiBaseUrl: string = "https://li.quest/v1",
    integratorId: string = "sessionfi-amm",
  ) {
    this.apiBaseUrl = apiBaseUrl;
    this.integratorId = integratorId;
    this.initializeSupportedTokens();
  }

  // ==========================================================================
  // ROUTE FINDING
  // ==========================================================================

  /**
   * Get optimal routes for cross-chain swap
   */
  async getRoutes(
    request: LiFiQuoteRequest,
    preferences: RoutePreferences = {
      priority: "CHEAPEST",
      maxBridges: 2,
      maxSteps: 5,
    },
  ): Promise<LiFiRoute[]> {
    // Check cache first
    const cacheKey = this.getCacheKey(request);
    const cached = this.cachedRoutes.get(cacheKey);
    if (cached && cached.length > 0) {
      return cached;
    }

    // Simulate LI.FI API response for demo
    const routes = await this.simulateRouteDiscovery(request, preferences);

    // Cache routes
    this.cachedRoutes.set(cacheKey, routes);

    // Sort by preference
    return this.sortRoutesByPreference(routes, preferences.priority);
  }

  /**
   * Get best single route
   */
  async getBestRoute(
    request: LiFiQuoteRequest,
    preferences: RoutePreferences = {
      priority: "CHEAPEST",
      maxBridges: 2,
      maxSteps: 5,
    },
  ): Promise<LiFiRoute | null> {
    const routes = await this.getRoutes(request, preferences);
    return routes.length > 0 ? routes[0] : null;
  }

  /**
   * Execute cross-chain swap within session
   */
  async executeCrossChainSwap(
    session: AMMSession,
    intent: CrossDexSwapIntent,
    route: LiFiRoute,
  ): Promise<CrossChainExecutionResult> {
    try {
      // Validate session has required tokens
      const availableAmount =
        session.availableTokens.get(intent.tokenIn.address) || BigInt(0);

      if (availableAmount < intent.amountIn) {
        return {
          success: false,
          error: `Insufficient ${intent.tokenIn.symbol}: have ${availableAmount}, need ${intent.amountIn}`,
        };
      }

      // Validate route
      if (route.fromAmount !== intent.amountIn) {
        return {
          success: false,
          error: "Route amount mismatch",
        };
      }

      // Check slippage
      if (route.toAmount < intent.minAmountOut) {
        return {
          success: false,
          error: `Output ${route.toAmount} below minimum ${intent.minAmountOut}`,
        };
      }

      // Simulate execution of each step
      const stepResults: StepExecutionResult[] = [];
      for (const step of route.steps) {
        const stepResult = await this.executeStep(step);
        stepResults.push(stepResult);

        if (!stepResult.success) {
          return {
            success: false,
            error: `Step ${step.stepId} failed: ${stepResult.error}`,
            completedSteps: stepResults,
          };
        }
      }

      // Update session balances
      const currentIn =
        session.availableTokens.get(intent.tokenIn.address) || BigInt(0);
      session.availableTokens.set(
        intent.tokenIn.address,
        currentIn - intent.amountIn,
      );

      // For cross-chain, output goes to destination chain
      // In session, we track it as a pending cross-chain transfer
      const crossChainTransferId = hashStringSync(
        `xchain:${session.sessionId}:${intent.intentId}:${Date.now()}`,
      );

      // Update session metrics
      session.totalSwapVolume += intent.amountIn;
      session.totalGasSaved += route.estimatedGas; // Would have cost this on-chain

      return {
        success: true,
        route,
        stepResults,
        crossChainTransferId,
        estimatedArrival: Date.now() + route.estimatedDuration * 1000,
        outputAmount: route.toAmount,
        gasSaved: route.estimatedGas,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Execution failed",
      };
    }
  }

  // ==========================================================================
  // STEP EXECUTION
  // ==========================================================================

  /**
   * Execute a single step in the route
   */
  private async executeStep(step: LiFiStep): Promise<StepExecutionResult> {
    // Simulate step execution
    await this.delay(100); // Simulate network delay

    switch (step.type) {
      case "APPROVE":
        return {
          success: true,
          stepId: step.stepId,
          type: step.type,
          txHash: this.generateTxHash(step),
          gasUsed: step.estimatedGas,
        };

      case "SWAP":
        return {
          success: true,
          stepId: step.stepId,
          type: step.type,
          txHash: this.generateTxHash(step),
          gasUsed: step.estimatedGas,
          amountIn: step.fromAmount,
          amountOut: step.toAmount,
        };

      case "BRIDGE":
        return {
          success: true,
          stepId: step.stepId,
          type: step.type,
          txHash: this.generateTxHash(step),
          gasUsed: step.estimatedGas,
          bridgeData: step.bridgeData,
          bridgeTxHash: this.generateTxHash(step),
        };

      default:
        return {
          success: false,
          stepId: step.stepId,
          type: step.type,
          error: `Unknown step type: ${step.type}`,
        };
    }
  }

  // ==========================================================================
  // ROUTE SIMULATION
  // ==========================================================================

  /**
   * Simulate LI.FI route discovery (demo purposes)
   */
  private async simulateRouteDiscovery(
    request: LiFiQuoteRequest,
    preferences: RoutePreferences,
  ): Promise<LiFiRoute[]> {
    await this.delay(200); // Simulate API call

    const routes: LiFiRoute[] = [];

    // Same chain swap
    if (request.fromChainId === request.toChainId) {
      routes.push(this.createSameChainRoute(request));
    } else {
      // Cross-chain routes
      routes.push(
        this.createCrossChainRoute(request, Bridge.STARGATE, "stargate"),
        this.createCrossChainRoute(request, Bridge.ACROSS, "across"),
        this.createCrossChainRoute(request, Bridge.HOP, "hop"),
      );

      // Filter by preferences
      const filteredRoutes = routes.filter((route) => {
        if (preferences.excludedBridges) {
          const bridgeUsed = route.steps.find((s) => s.bridgeData)?.bridgeData
            ?.bridge;
          if (bridgeUsed && preferences.excludedBridges.includes(bridgeUsed)) {
            return false;
          }
        }
        return route.steps.length <= preferences.maxSteps;
      });

      return filteredRoutes;
    }

    return routes;
  }

  /**
   * Create same-chain swap route
   */
  private createSameChainRoute(request: LiFiQuoteRequest): LiFiRoute {
    const fromToken = this.getToken(request.fromChainId, request.fromToken);
    const toToken = this.getToken(request.toChainId, request.toToken);

    // Calculate output with 0.3% fee
    const fee = (request.fromAmount * BigInt(30)) / BigInt(10000);
    const outputAmount = request.fromAmount - fee;

    const steps: LiFiStep[] = [
      {
        stepId: 1,
        type: "SWAP",
        protocol: "uniswap-v4",
        chainId: request.fromChainId,
        fromToken: request.fromToken,
        toToken: request.toToken,
        fromAmount: request.fromAmount,
        toAmount: outputAmount,
        estimatedGas: BigInt(150000),
      },
    ];

    return {
      routeId: hashStringSync(
        `route:same:${request.fromToken}:${request.toToken}:${Date.now()}`,
      ),
      fromChainId: request.fromChainId,
      toChainId: request.toChainId,
      fromToken: fromToken!,
      toToken: toToken!,
      fromAmount: request.fromAmount,
      toAmount: outputAmount,
      steps,
      estimatedDuration: 15, // 15 seconds
      estimatedGas: BigInt(150000),
      bridgeFee: BigInt(0),
      priceImpact: 0.1,
      tags: ["FASTEST"],
    };
  }

  /**
   * Create cross-chain route with specific bridge
   */
  private createCrossChainRoute(
    request: LiFiQuoteRequest,
    bridge: Bridge,
    protocol: string,
  ): LiFiRoute {
    const fromToken = this.getToken(request.fromChainId, request.fromToken);
    const toToken = this.getToken(request.toChainId, request.toToken);

    // Bridge fees vary by protocol
    const bridgeFees: Record<Bridge, number> = {
      [Bridge.STARGATE]: 50, // 0.5%
      [Bridge.HOP]: 40, // 0.4%
      [Bridge.ACROSS]: 35, // 0.35%
      [Bridge.CBRIDGE]: 45, // 0.45%
      [Bridge.WORMHOLE]: 30, // 0.3%
      [Bridge.LAYERZERO]: 25, // 0.25%
    };

    const bridgeFeeRate = bridgeFees[bridge] || 50;
    const bridgeFee =
      (request.fromAmount * BigInt(bridgeFeeRate)) / BigInt(10000);
    const swapFee = (request.fromAmount * BigInt(30)) / BigInt(10000);
    const outputAmount = request.fromAmount - bridgeFee - swapFee;

    // Estimated times vary by bridge
    const bridgeTimes: Record<Bridge, number> = {
      [Bridge.STARGATE]: 120, // 2 minutes
      [Bridge.HOP]: 300, // 5 minutes
      [Bridge.ACROSS]: 60, // 1 minute
      [Bridge.CBRIDGE]: 180, // 3 minutes
      [Bridge.WORMHOLE]: 900, // 15 minutes
      [Bridge.LAYERZERO]: 90, // 1.5 minutes
    };

    const estimatedTime = bridgeTimes[bridge] || 300;

    const steps: LiFiStep[] = [
      // Approve
      {
        stepId: 1,
        type: "APPROVE",
        protocol: protocol,
        chainId: request.fromChainId,
        fromToken: request.fromToken,
        toToken: request.fromToken,
        fromAmount: request.fromAmount,
        toAmount: request.fromAmount,
        estimatedGas: BigInt(50000),
      },
      // Swap on source chain (if needed)
      {
        stepId: 2,
        type: "SWAP",
        protocol: "uniswap-v4",
        chainId: request.fromChainId,
        fromToken: request.fromToken,
        toToken: request.fromToken, // Swap to bridge token if needed
        fromAmount: request.fromAmount,
        toAmount: request.fromAmount - swapFee,
        estimatedGas: BigInt(150000),
      },
      // Bridge
      {
        stepId: 3,
        type: "BRIDGE",
        protocol: protocol,
        chainId: request.fromChainId,
        fromToken: request.fromToken,
        toToken: request.toToken,
        fromAmount: request.fromAmount - swapFee,
        toAmount: outputAmount,
        estimatedGas: BigInt(200000),
        bridgeData: {
          bridge,
          srcChainId: request.fromChainId,
          dstChainId: request.toChainId,
          sendingAsset: request.fromToken,
          receivingAsset: request.toToken,
          amount: request.fromAmount - swapFee,
          fee: bridgeFee,
          estimatedTime,
        },
      },
    ];

    // Determine tags
    const tags: string[] = [];
    if (estimatedTime <= 120) tags.push("FASTEST");
    if (bridgeFeeRate <= 35) tags.push("CHEAPEST");
    if (bridge === Bridge.WORMHOLE || bridge === Bridge.LAYERZERO)
      tags.push("SAFEST");

    return {
      routeId: hashStringSync(
        `route:${bridge}:${request.fromToken}:${request.toToken}:${Date.now()}`,
      ),
      fromChainId: request.fromChainId,
      toChainId: request.toChainId,
      fromToken: fromToken!,
      toToken: toToken!,
      fromAmount: request.fromAmount,
      toAmount: outputAmount,
      steps,
      estimatedDuration: estimatedTime,
      estimatedGas: BigInt(400000),
      bridgeFee,
      priceImpact: 0.15,
      tags,
    };
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private initializeSupportedTokens(): void {
    // Ethereum tokens
    this.supportedTokens.set(SupportedChain.ETHEREUM, [
      {
        address: "0xUSDC",
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        chainId: SupportedChain.ETHEREUM,
      },
      {
        address: "0xWETH",
        symbol: "WETH",
        name: "Wrapped Ether",
        decimals: 18,
        chainId: SupportedChain.ETHEREUM,
      },
      {
        address: "0xUSDT",
        symbol: "USDT",
        name: "Tether",
        decimals: 6,
        chainId: SupportedChain.ETHEREUM,
      },
    ]);

    // Arbitrum tokens
    this.supportedTokens.set(SupportedChain.ARBITRUM, [
      {
        address: "0xUSDC_ARB",
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        chainId: SupportedChain.ARBITRUM,
      },
      {
        address: "0xWETH_ARB",
        symbol: "WETH",
        name: "Wrapped Ether",
        decimals: 18,
        chainId: SupportedChain.ARBITRUM,
      },
    ]);

    // Sui tokens (placeholder)
    this.supportedTokens.set(SupportedChain.SUI, [
      {
        address: "0xSUI",
        symbol: "SUI",
        name: "Sui",
        decimals: 9,
        chainId: SupportedChain.SUI,
      },
      {
        address: "0xUSDC_SUI",
        symbol: "USDC",
        name: "USD Coin (Sui)",
        decimals: 6,
        chainId: SupportedChain.SUI,
      },
    ]);
  }

  private getToken(chainId: number, address: string): Token | undefined {
    const tokens = this.supportedTokens.get(chainId);
    return tokens?.find((t) => t.address === address);
  }

  private getCacheKey(request: LiFiQuoteRequest): string {
    return `${request.fromChainId}:${request.toChainId}:${request.fromToken}:${request.toToken}:${request.fromAmount}`;
  }

  private sortRoutesByPreference(
    routes: LiFiRoute[],
    priority: "FASTEST" | "CHEAPEST" | "SAFEST",
  ): LiFiRoute[] {
    return routes.sort((a, b) => {
      switch (priority) {
        case "FASTEST":
          return a.estimatedDuration - b.estimatedDuration;
        case "CHEAPEST":
          return Number(a.bridgeFee - b.bridgeFee);
        case "SAFEST":
          // Prefer routes with SAFEST tag
          const aHasSafe = a.tags.includes("SAFEST") ? -1 : 1;
          const bHasSafe = b.tags.includes("SAFEST") ? -1 : 1;
          return aHasSafe - bHasSafe;
        default:
          return 0;
      }
    });
  }

  private generateTxHash(step: LiFiStep): string {
    return (
      "0x" + hashStringSync(`tx:${step.stepId}:${step.type}:${Date.now()}`)
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ==========================================================================
  // PUBLIC UTILITIES
  // ==========================================================================

  /**
   * Get supported chains
   */
  getSupportedChains(): number[] {
    return Array.from(this.supportedTokens.keys());
  }

  /**
   * Get supported tokens for a chain
   */
  getSupportedTokens(chainId: number): Token[] {
    return this.supportedTokens.get(chainId) || [];
  }

  /**
   * Check if a route is still valid
   */
  isRouteValid(route: LiFiRoute, maxAgeMs: number = 60000): boolean {
    // Routes are valid for 1 minute by default
    const routeAge =
      Date.now() - parseInt(route.routeId.split(":").pop() || "0");
    return routeAge < maxAgeMs;
  }

  /**
   * Estimate total cost (gas + bridge fees)
   */
  estimateTotalCost(route: LiFiRoute, gasPrice: bigint): bigint {
    return route.estimatedGas * gasPrice + route.bridgeFee;
  }
}

// ============================================================================
// RESULT TYPES
// ============================================================================

export interface StepExecutionResult {
  success: boolean;
  stepId: number;
  type: string;
  txHash?: string;
  gasUsed?: bigint;
  amountIn?: bigint;
  amountOut?: bigint;
  bridgeData?: BridgeData;
  bridgeTxHash?: string;
  error?: string;
}

export interface CrossChainExecutionResult {
  success: boolean;
  route?: LiFiRoute;
  stepResults?: StepExecutionResult[];
  crossChainTransferId?: string;
  estimatedArrival?: number;
  outputAmount?: bigint;
  gasSaved?: bigint;
  completedSteps?: StepExecutionResult[];
  error?: string;
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const lifiRouter = new LiFiRouter();
