/**
 * AMM Sessions Module - Public Exports
 *
 * Intent-Based AMM Sessions combining SessionFi with Uniswap v4 hooks
 * and Sui settlement for gasless, programmable DeFi interactions.
 */

// Core Types
export * from "./types";

// Engine
export { IntentEngine, intentEngine } from "./engine/intent-engine";
export type {
  IntentSubmissionResult,
  IntentExecutionResult,
} from "./engine/intent-engine";

// Uniswap v4 Hooks
export {
  SessionHookManager,
  sessionHookManager,
  SESSION_HOOK_FLAGS,
  deriveHookAddress,
} from "./hooks/uniswap-v4-hooks";
export type {
  BeforeSwapResult,
  AfterSwapResult,
  BeforeLiquidityResult,
  AfterLiquidityResult,
} from "./hooks/uniswap-v4-hooks";

// Sui Settlement
export {
  SuiSettlementEngine,
  suiSettlementEngine,
  SuiEventType,
} from "./settlement/sui-settlement";
export type {
  SuiSettlementResult,
  SuiEvent,
  SuiSessionObject,
  SuiPositionNFT,
} from "./settlement/sui-settlement";

// Advanced Verification
export {
  AdvancedSettlementVerifier,
  advancedVerifier,
  FraudType,
  FraudProofStatus,
  ZKCircuitType,
} from "./settlement/advanced-verifier";
export type {
  VerificationResult,
  VerificationCheck,
  MerkleProof,
  MerkleNode,
  FraudProof,
  FraudEvidence,
  ZKProof,
  ThresholdSignature,
  PartialSignature,
  VerificationOptions,
  VerificationStats,
} from "./settlement/advanced-verifier";

// LI.FI Routing
export {
  LiFiRouter,
  lifiRouter,
  SupportedChain,
  Bridge,
} from "./routing/lifi-router";
export type {
  LiFiRoute,
  LiFiStep,
  LiFiQuoteRequest,
  RoutePreferences,
  CrossChainExecutionResult,
} from "./routing/lifi-router";
