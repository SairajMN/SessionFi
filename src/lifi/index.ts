/**
 * LI.FI Integration Module
 *
 * Real LI.FI SDK integration for cross-chain swaps and routing.
 * Replaces the simulated router with actual API calls.
 */

export { RealLiFiRouter, type LiFiQuoteResult } from "./real-lifi-router";
export { LiFiSessionIntegration } from "./lifi-session-integration";
export * from "./types";
