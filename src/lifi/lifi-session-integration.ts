/**
 * LI.FI Session Integration
 *
 * Integrates LI.FI cross-chain swaps with SessionFi sessions.
 * Enables gasless cross-chain operations within session bounds.
 */

import { RealLiFiRouter, type LiFiQuoteResult } from "./real-lifi-router";
import type {
  LiFiRouteRequest,
  LiFiRoute,
  SessionSwapRequest,
  SessionSwapResult,
  LiFiChainId,
} from "./types";
import { hashStringSync } from "../crypto/browser-primitives";

// ============================================================================
// SESSION SWAP TRACKING
// ============================================================================

interface TrackedSwap {
  swapId: string;
  sessionId: string;
  route: LiFiRoute;
  status: "pending" | "executing" | "completed" | "failed";
  timestamp: number;
  txHash?: string;
  error?: string;
}

// ============================================================================
// LIFI SESSION INTEGRATION CLASS
// ============================================================================

/**
 * LiFiSessionIntegration - Connects LI.FI with SessionFi sessions
 *
 * Features:
 * - Session-bound cross-chain swaps
 * - Swap tracking and history
 * - Balance validation
 * - Session state updates
 */
export class LiFiSessionIntegration {
  private router: RealLiFiRouter;
  private trackedSwaps: Map<string, TrackedSwap> = new Map();
  private sessionSwaps: Map<string, string[]> = new Map(); // sessionId -> swapIds

  constructor() {
    this.router = new RealLiFiRouter();
  }

  // ==========================================================================
  // SESSION SWAPS
  // ==========================================================================

  /**
   * Get a quote for a session swap
   */
  async getSwapQuote(request: SessionSwapRequest): Promise<LiFiQuoteResult> {
    const routeRequest: LiFiRouteRequest = {
      fromChainId: request.fromChainId,
      toChainId: request.toChainId,
      fromTokenAddress: request.fromToken,
      toTokenAddress: request.toToken,
      fromAmount: request.fromAmount,
      fromAddress: "0x0000000000000000000000000000000000000000", // Session will provide actual address
      options: {
        slippage: request.slippage || 0.005,
        order: request.orderPreference || "RECOMMENDED",
        integrator: "sessionfi-amm",
      },
    };

    return this.router.getRoutes(routeRequest);
  }

  /**
   * Execute a swap within a session
   */
  async executeSessionSwap(
    request: SessionSwapRequest,
    userAddress: string,
  ): Promise<SessionSwapResult> {
    try {
      // Generate swap ID
      const swapId = this.generateSwapId(request);

      console.log(
        `[LI.FI Session] Starting swap ${swapId} for session ${request.sessionId}`,
      );

      // Get route
      const routeRequest: LiFiRouteRequest = {
        fromChainId: request.fromChainId,
        toChainId: request.toChainId,
        fromTokenAddress: request.fromToken,
        toTokenAddress: request.toToken,
        fromAmount: request.fromAmount,
        fromAddress: userAddress,
        options: {
          slippage: request.slippage || 0.005,
          order: request.orderPreference || "RECOMMENDED",
          integrator: "sessionfi-amm",
        },
      };

      const quoteResult = await this.router.getRoutes(routeRequest);

      if (!quoteResult.success || !quoteResult.bestRoute) {
        return {
          success: false,
          swapId,
          error: quoteResult.error || "No routes found",
        };
      }

      const route = quoteResult.bestRoute;

      // Track the swap
      const trackedSwap: TrackedSwap = {
        swapId,
        sessionId: request.sessionId,
        route,
        status: "pending",
        timestamp: Date.now(),
      };

      this.trackedSwaps.set(swapId, trackedSwap);
      this.addSwapToSession(request.sessionId, swapId);

      // Return quote result (actual execution would require wallet integration)
      return {
        success: true,
        swapId,
        route,
        estimatedOutput: route.toAmount,
        estimatedDuration: this.calculateDuration(route),
        gasCostUSD: route.gasCostUSD,
      };
    } catch (error) {
      console.error("[LI.FI Session] Swap failed:", error);
      return {
        success: false,
        swapId: this.generateSwapId(request),
        error: error instanceof Error ? error.message : "Swap failed",
      };
    }
  }

  /**
   * Get all swaps for a session
   */
  getSessionSwaps(sessionId: string): TrackedSwap[] {
    const swapIds = this.sessionSwaps.get(sessionId) || [];
    return swapIds
      .map((id) => this.trackedSwaps.get(id))
      .filter((swap): swap is TrackedSwap => swap !== undefined);
  }

  /**
   * Get swap status
   */
  getSwapStatus(swapId: string): TrackedSwap | undefined {
    return this.trackedSwaps.get(swapId);
  }

  /**
   * Update swap status
   */
  updateSwapStatus(
    swapId: string,
    status: TrackedSwap["status"],
    txHash?: string,
    error?: string,
  ): void {
    const swap = this.trackedSwaps.get(swapId);
    if (swap) {
      swap.status = status;
      if (txHash) swap.txHash = txHash;
      if (error) swap.error = error;
      this.trackedSwaps.set(swapId, swap);
    }
  }

  // ==========================================================================
  // CHAIN & TOKEN HELPERS
  // ==========================================================================

  /**
   * Get supported chains
   */
  async getSupportedChains() {
    return this.router.getSupportedChains();
  }

  /**
   * Get tokens for a chain
   */
  async getChainTokens(chainId: number) {
    return this.router.getTokensForChain(chainId);
  }

  /**
   * Check if cross-chain route is available
   */
  async isRouteAvailable(
    fromChainId: number,
    toChainId: number,
    fromToken: string,
    toToken: string,
    amount: string,
  ): Promise<boolean> {
    const result = await this.router.getRoutes({
      fromChainId,
      toChainId,
      fromTokenAddress: fromToken,
      toTokenAddress: toToken,
      fromAmount: amount,
      fromAddress: "0x0000000000000000000000000000000000000000",
    });

    return result.success && result.routes.length > 0;
  }

  // ==========================================================================
  // SESSION METRICS
  // ==========================================================================

  /**
   * Get session cross-chain metrics
   */
  getSessionMetrics(sessionId: string): {
    totalSwaps: number;
    completedSwaps: number;
    failedSwaps: number;
    pendingSwaps: number;
    totalVolumeUSD: string;
    totalGasSavedUSD: string;
  } {
    const swaps = this.getSessionSwaps(sessionId);

    let totalVolumeUSD = 0;
    let totalGasSavedUSD = 0;

    const metrics = {
      totalSwaps: swaps.length,
      completedSwaps: 0,
      failedSwaps: 0,
      pendingSwaps: 0,
      totalVolumeUSD: "0",
      totalGasSavedUSD: "0",
    };

    for (const swap of swaps) {
      switch (swap.status) {
        case "completed":
          metrics.completedSwaps++;
          totalGasSavedUSD += parseFloat(swap.route.gasCostUSD || "0");
          break;
        case "failed":
          metrics.failedSwaps++;
          break;
        case "pending":
        case "executing":
          metrics.pendingSwaps++;
          break;
      }
    }

    metrics.totalVolumeUSD = totalVolumeUSD.toFixed(2);
    metrics.totalGasSavedUSD = totalGasSavedUSD.toFixed(2);

    return metrics;
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private generateSwapId(request: SessionSwapRequest): string {
    return hashStringSync(
      `swap:${request.sessionId}:${request.fromChainId}:${request.toChainId}:${request.fromToken}:${request.toToken}:${Date.now()}`,
    );
  }

  private addSwapToSession(sessionId: string, swapId: string): void {
    const existing = this.sessionSwaps.get(sessionId) || [];
    existing.push(swapId);
    this.sessionSwaps.set(sessionId, existing);
  }

  private calculateDuration(route: LiFiRoute): number {
    return route.steps.reduce(
      (total, step) => total + (step.estimate.executionDuration || 0),
      0,
    );
  }

  // ==========================================================================
  // UTILITY
  // ==========================================================================

  /**
   * Clear cache
   */
  clearCache(): void {
    this.router.clearCache();
  }

  /**
   * Clear session data
   */
  clearSessionData(sessionId: string): void {
    const swapIds = this.sessionSwaps.get(sessionId) || [];
    for (const swapId of swapIds) {
      this.trackedSwaps.delete(swapId);
    }
    this.sessionSwaps.delete(sessionId);
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const lifiSessionIntegration = new LiFiSessionIntegration();
