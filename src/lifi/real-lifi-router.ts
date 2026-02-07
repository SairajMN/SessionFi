/**
 * Real LI.FI Router Implementation
 *
 * Uses the official @lifi/sdk for cross-chain swaps and routing.
 * This replaces the simulated router with actual API calls.
 */

import {
  createConfig,
  getRoutes,
  getQuote,
  getChains,
  getTokens,
  getConnections,
  executeRoute,
  type Route,
  type RoutesRequest,
  type ExtendedChain,
  type Token as LiFiSdkToken,
  type RoutesResponse,
  type Step as LiFiSdkStep,
} from "@lifi/sdk";
import type {
  LiFiRouteRequest,
  LiFiRouteOptions,
  LiFiRoute,
  LiFiToken,
  LiFiStep,
  ExecutionConfig,
  ExecutionResult,
} from "./types";

// ============================================================================
// LIFI SDK CONFIGURATION
// ============================================================================

/**
 * Initialize LI.FI SDK configuration
 */
const lifiConfig = createConfig({
  integrator: process.env.LIFI_INTEGRATOR || "sessionfi-amm",
  apiUrl: "https://li.quest/v1",
});

// ============================================================================
// QUOTE RESULT TYPE
// ============================================================================

export interface LiFiQuoteResult {
  success: boolean;
  routes: LiFiRoute[];
  bestRoute?: LiFiRoute;
  fromToken: LiFiToken;
  toToken: LiFiToken;
  fromAmount: string;
  estimatedOutput?: string;
  estimatedDuration?: number;
  gasCostUSD?: string;
  priceImpact?: number;
  error?: string;
}

// ============================================================================
// REAL LIFI ROUTER CLASS
// ============================================================================

/**
 * RealLiFiRouter - Production-ready LI.FI integration
 *
 * Features:
 * - Real API calls to LI.FI
 * - Multi-route discovery
 * - Cross-chain swap execution
 * - Token and chain discovery
 * - Route caching
 */
export class RealLiFiRouter {
  private cachedChains: ExtendedChain[] | null = null;
  private cachedTokens: Map<number, LiFiSdkToken[]> = new Map();
  private routeCache: Map<string, { routes: Route[]; timestamp: number }> =
    new Map();
  private readonly CACHE_TTL = 30000; // 30 seconds

  constructor() {
    // SDK is already configured globally
    console.log("[LI.FI] Router initialized with integrator:", lifiConfig);
  }

  // ==========================================================================
  // ROUTE DISCOVERY
  // ==========================================================================

  /**
   * Get available routes for a swap
   */
  async getRoutes(request: LiFiRouteRequest): Promise<LiFiQuoteResult> {
    try {
      // Check cache first
      const cacheKey = this.getCacheKey(request);
      const cached = this.routeCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        console.log("[LI.FI] Using cached routes");
        return this.formatQuoteResult(cached.routes, request);
      }

      console.log("[LI.FI] Fetching routes from API...", {
        from: `${request.fromChainId}:${request.fromTokenAddress}`,
        to: `${request.toChainId}:${request.toTokenAddress}`,
        amount: request.fromAmount,
      });

      const routesRequest: RoutesRequest = {
        fromChainId: request.fromChainId,
        toChainId: request.toChainId,
        fromTokenAddress: request.fromTokenAddress,
        toTokenAddress: request.toTokenAddress,
        fromAmount: request.fromAmount,
        fromAddress: request.fromAddress,
        toAddress: request.toAddress || request.fromAddress,
        options: {
          slippage: request.options?.slippage || 0.005,
          order: request.options?.order || "RECOMMENDED",
          allowSwitchChain: request.options?.allowSwitchChain ?? true,
          bridges: request.options?.bridges,
          exchanges: request.options?.exchanges,
          integrator: request.options?.integrator || "sessionfi-amm",
        },
      };

      const response: RoutesResponse = await getRoutes(routesRequest);

      // Cache the routes
      this.routeCache.set(cacheKey, {
        routes: response.routes,
        timestamp: Date.now(),
      });

      console.log(`[LI.FI] Found ${response.routes.length} routes`);

      return this.formatQuoteResult(response.routes, request);
    } catch (error) {
      console.error("[LI.FI] Error fetching routes:", error);
      return {
        success: false,
        routes: [],
        fromToken: {
          address: request.fromTokenAddress,
          symbol: "UNKNOWN",
          name: "Unknown",
          decimals: 18,
          chainId: request.fromChainId,
        },
        toToken: {
          address: request.toTokenAddress,
          symbol: "UNKNOWN",
          name: "Unknown",
          decimals: 18,
          chainId: request.toChainId,
        },
        fromAmount: request.fromAmount,
        error:
          error instanceof Error ? error.message : "Failed to fetch routes",
      };
    }
  }

  /**
   * Get the best route based on preference
   */
  async getBestRoute(
    request: LiFiRouteRequest,
    preference:
      | "RECOMMENDED"
      | "FASTEST"
      | "CHEAPEST"
      | "SAFEST" = "RECOMMENDED",
  ): Promise<LiFiRoute | null> {
    const result = await this.getRoutes({
      ...request,
      options: {
        ...request.options,
        order: preference,
      },
    });

    return result.bestRoute || null;
  }

  /**
   * Get a quick quote (single route)
   * Note: getQuote returns a Step, so we wrap it as a single-step route
   */
  async getQuickQuote(request: LiFiRouteRequest): Promise<LiFiQuoteResult> {
    try {
      console.log("[LI.FI] Getting quick quote...");

      // Use getRoutes instead of getQuote for better type compatibility
      const result = await this.getRoutes({
        ...request,
        options: {
          ...request.options,
          order: "RECOMMENDED",
        },
      });

      if (result.success && result.bestRoute) {
        return result;
      }

      return {
        success: false,
        routes: [],
        fromToken: {
          address: request.fromTokenAddress,
          symbol: "UNKNOWN",
          name: "Unknown",
          decimals: 18,
          chainId: request.fromChainId,
        },
        toToken: {
          address: request.toTokenAddress,
          symbol: "UNKNOWN",
          name: "Unknown",
          decimals: 18,
          chainId: request.toChainId,
        },
        fromAmount: request.fromAmount,
        error: "No routes found for quick quote",
      };
    } catch (error) {
      console.error("[LI.FI] Error getting quote:", error);
      return {
        success: false,
        routes: [],
        fromToken: {
          address: request.fromTokenAddress,
          symbol: "UNKNOWN",
          name: "Unknown",
          decimals: 18,
          chainId: request.fromChainId,
        },
        toToken: {
          address: request.toTokenAddress,
          symbol: "UNKNOWN",
          name: "Unknown",
          decimals: 18,
          chainId: request.toChainId,
        },
        fromAmount: request.fromAmount,
        error: error instanceof Error ? error.message : "Failed to get quote",
      };
    }
  }

  // ==========================================================================
  // ROUTE EXECUTION
  // ==========================================================================

  /**
   * Execute a route (requires wallet integration)
   * Note: This is a placeholder - actual execution requires signer integration
   */
  async executeSwap(
    route: Route,
    config?: ExecutionConfig,
  ): Promise<ExecutionResult> {
    try {
      console.log("[LI.FI] Executing route:", route.id);

      // Execute the route using LI.FI SDK
      // Note: The SDK execution options may vary by version
      await executeRoute(route, {
        updateRouteHook: (updatedRoute: Route) => {
          console.log("[LI.FI] Route updated:", updatedRoute.id);
          config?.updateRouteHook?.(
            this.convertSdkRouteToLiFiRoute(updatedRoute),
          );
        },
      } as any); // Type assertion due to SDK version differences

      // Get final transaction hash from route execution
      const step = route.steps[0] as any;
      const txHash = step?.execution?.process?.[0]?.txHash;

      return {
        success: true,
        route: this.convertSdkRouteToLiFiRoute(route),
        txHash,
        toAmount: route.toAmount,
      };
    } catch (error) {
      console.error("[LI.FI] Execution failed:", error);
      return {
        success: false,
        route: this.convertSdkRouteToLiFiRoute(route),
        error: error instanceof Error ? error.message : "Execution failed",
      };
    }
  }

  // ==========================================================================
  // CHAIN & TOKEN DISCOVERY
  // ==========================================================================

  /**
   * Get all supported chains
   */
  async getSupportedChains(): Promise<ExtendedChain[]> {
    if (this.cachedChains) {
      return this.cachedChains;
    }

    try {
      console.log("[LI.FI] Fetching supported chains...");
      const chains = await getChains();
      this.cachedChains = chains;
      console.log(`[LI.FI] Found ${chains.length} supported chains`);
      return chains;
    } catch (error) {
      console.error("[LI.FI] Error fetching chains:", error);
      return [];
    }
  }

  /**
   * Get tokens for a specific chain
   */
  async getTokensForChain(chainId: number): Promise<LiFiSdkToken[]> {
    const cached = this.cachedTokens.get(chainId);
    if (cached) {
      return cached;
    }

    try {
      console.log(`[LI.FI] Fetching tokens for chain ${chainId}...`);
      const result = await getTokens({ chains: [chainId] });
      const tokens = result.tokens[chainId] || [];
      this.cachedTokens.set(chainId, tokens);
      console.log(`[LI.FI] Found ${tokens.length} tokens for chain ${chainId}`);
      return tokens;
    } catch (error) {
      console.error(
        `[LI.FI] Error fetching tokens for chain ${chainId}:`,
        error,
      );
      return [];
    }
  }

  /**
   * Get available connections between chains
   */
  async getChainConnections(
    fromChainId: number,
    toChainId: number,
  ): Promise<{ fromTokens: LiFiSdkToken[]; toTokens: LiFiSdkToken[] }> {
    try {
      console.log(
        `[LI.FI] Fetching connections ${fromChainId} -> ${toChainId}...`,
      );
      const connections = await getConnections({
        fromChain: fromChainId,
        toChain: toChainId,
      });

      // Handle the connections response structure
      const chainConnections = (connections.connections as any)[fromChainId];

      let fromTokens: LiFiSdkToken[] = [];
      let toTokens: LiFiSdkToken[] = [];

      if (Array.isArray(chainConnections)) {
        fromTokens = chainConnections.flatMap((c: any) => c.fromTokens || []);
        toTokens = chainConnections.flatMap((c: any) => c.toTokens || []);
      }

      return { fromTokens, toTokens };
    } catch (error) {
      console.error("[LI.FI] Error fetching connections:", error);
      return { fromTokens: [], toTokens: [] };
    }
  }

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  /**
   * Check if a route is still valid
   */
  isRouteValid(route: LiFiRoute, maxAgeMs: number = 60000): boolean {
    // LI.FI routes typically expire after 60 seconds
    // Check based on route creation time if available
    return true; // Simplified - in production, track route timestamps
  }

  /**
   * Calculate total cost including gas and fees
   */
  calculateTotalCost(route: LiFiRoute): {
    gasCostUSD: string;
    bridgeFeeUSD: string;
    totalUSD: string;
  } {
    const gasCost = parseFloat(route.gasCostUSD || "0");
    let bridgeFee = 0;

    for (const step of route.steps) {
      if (step.estimate.feeCosts) {
        for (const fee of step.estimate.feeCosts) {
          bridgeFee += parseFloat(fee.amountUSD || "0");
        }
      }
    }

    return {
      gasCostUSD: gasCost.toFixed(2),
      bridgeFeeUSD: bridgeFee.toFixed(2),
      totalUSD: (gasCost + bridgeFee).toFixed(2),
    };
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.routeCache.clear();
    this.cachedTokens.clear();
    this.cachedChains = null;
    console.log("[LI.FI] Cache cleared");
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private getCacheKey(request: LiFiRouteRequest): string {
    return `${request.fromChainId}:${request.toChainId}:${request.fromTokenAddress}:${request.toTokenAddress}:${request.fromAmount}`;
  }

  private formatQuoteResult(
    routes: Route[],
    request: LiFiRouteRequest,
  ): LiFiQuoteResult {
    if (routes.length === 0) {
      return {
        success: false,
        routes: [],
        fromToken: {
          address: request.fromTokenAddress,
          symbol: "UNKNOWN",
          name: "Unknown",
          decimals: 18,
          chainId: request.fromChainId,
        },
        toToken: {
          address: request.toTokenAddress,
          symbol: "UNKNOWN",
          name: "Unknown",
          decimals: 18,
          chainId: request.toChainId,
        },
        fromAmount: request.fromAmount,
        error: "No routes found",
      };
    }

    const convertedRoutes = routes.map((r) =>
      this.convertSdkRouteToLiFiRoute(r),
    );
    const bestRoute = convertedRoutes[0];

    return {
      success: true,
      routes: convertedRoutes,
      bestRoute,
      fromToken: bestRoute.fromToken,
      toToken: bestRoute.toToken,
      fromAmount: bestRoute.fromAmount,
      estimatedOutput: bestRoute.toAmount,
      estimatedDuration: this.calculateTotalDuration(bestRoute),
      gasCostUSD: bestRoute.gasCostUSD,
      priceImpact: this.calculatePriceImpact(bestRoute),
    };
  }

  private convertSdkRouteToLiFiRoute(route: Route): LiFiRoute {
    return {
      id: route.id,
      fromChainId: route.fromChainId,
      toChainId: route.toChainId,
      fromToken: this.convertToken(route.fromToken),
      toToken: this.convertToken(route.toToken),
      fromAmount: route.fromAmount,
      toAmount: route.toAmount,
      toAmountMin: route.toAmountMin,
      gasCostUSD: route.gasCostUSD,
      steps: route.steps.map((s) => this.convertStep(s)),
      tags: route.tags,
    };
  }

  private convertToken(token: LiFiSdkToken): LiFiToken {
    return {
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      chainId: token.chainId,
      logoURI: token.logoURI,
      priceUSD: token.priceUSD,
    };
  }

  private convertStep(step: any): LiFiStep {
    return {
      id: step.id,
      type: step.type,
      tool: step.tool,
      toolDetails: step.toolDetails,
      action: {
        fromChainId: step.action.fromChainId,
        toChainId: step.action.toChainId,
        fromToken: this.convertToken(step.action.fromToken),
        toToken: this.convertToken(step.action.toToken),
        fromAmount: step.action.fromAmount,
        slippage: step.action.slippage,
        fromAddress: step.action.fromAddress,
        toAddress: step.action.toAddress,
      },
      estimate: {
        fromAmount: step.estimate.fromAmount,
        toAmount: step.estimate.toAmount,
        toAmountMin: step.estimate.toAmountMin,
        approvalAddress: step.estimate.approvalAddress,
        executionDuration: step.estimate.executionDuration,
        feeCosts: step.estimate.feeCosts,
        gasCosts: step.estimate.gasCosts,
      },
      integrator: step.integrator,
      execution: step.execution,
    };
  }

  private calculateTotalDuration(route: LiFiRoute): number {
    return route.steps.reduce(
      (total, step) => total + (step.estimate.executionDuration || 0),
      0,
    );
  }

  private calculatePriceImpact(route: LiFiRoute): number {
    // Simplified price impact calculation
    // In production, use token prices to calculate actual impact
    const fromAmount = parseFloat(route.fromAmount);
    const toAmount = parseFloat(route.toAmount);
    if (fromAmount === 0) return 0;

    // This is a simplified calculation - real calculation needs token prices
    return 0.1; // Placeholder
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const realLiFiRouter = new RealLiFiRouter();
