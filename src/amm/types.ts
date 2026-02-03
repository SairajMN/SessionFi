/**
 * Intent-Based AMM Sessions - Core Types
 *
 * Combines SessionFi's intent-based settlement with Uniswap v4's hook system
 * to create programmable, gasless AMM interactions.
 *
 * Architecture: User Intent → SessionFi (Yellow) → Uniswap v4 Hooks → Sui Settlement
 */

// ============================================================================
// TOKEN & POOL TYPES
// ============================================================================

/**
 * Token representation for AMM operations
 */
export interface Token {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  chainId: number;
  logoUri?: string;
}

/**
 * Pool configuration following Uniswap v4 structure
 */
export interface PoolKey {
  currency0: string; // Lower sorted address
  currency1: string; // Higher sorted address
  fee: number; // Fee in bps (e.g., 3000 = 0.30%)
  tickSpacing: number;
  hooks: string; // Hook contract address
}

/**
 * Pool state representation
 */
export interface PoolState {
  poolId: string;
  poolKey: PoolKey;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  feeGrowthGlobal0X128: bigint;
  feeGrowthGlobal1X128: bigint;
}

/**
 * Liquidity position
 */
export interface LiquidityPosition {
  positionId: string;
  poolId: string;
  owner: string;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  feeGrowthInside0LastX128: bigint;
  feeGrowthInside1LastX128: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
}

// ============================================================================
// INTENT TYPES
// ============================================================================

/**
 * Intent types supported by the AMM session system
 */
export enum IntentType {
  // Swap intents
  EXACT_INPUT_SWAP = "EXACT_INPUT_SWAP",
  EXACT_OUTPUT_SWAP = "EXACT_OUTPUT_SWAP",
  LIMIT_ORDER = "LIMIT_ORDER",
  TWAP_ORDER = "TWAP_ORDER", // Time-weighted average price

  // Liquidity intents
  ADD_LIQUIDITY = "ADD_LIQUIDITY",
  REMOVE_LIQUIDITY = "REMOVE_LIQUIDITY",
  REBALANCE_POSITION = "REBALANCE_POSITION",

  // Advanced intents
  MULTI_HOP_SWAP = "MULTI_HOP_SWAP",
  CROSS_DEX_SWAP = "CROSS_DEX_SWAP",
  BATCH_SWAP = "BATCH_SWAP",

  // Strategy intents
  DCA_SWAP = "DCA_SWAP", // Dollar cost averaging
  STOP_LOSS = "STOP_LOSS",
  TAKE_PROFIT = "TAKE_PROFIT",
}

/**
 * Intent status throughout lifecycle
 */
export enum IntentStatus {
  PENDING = "PENDING",
  VALIDATING = "VALIDATING",
  EXECUTING = "EXECUTING",
  PARTIALLY_FILLED = "PARTIALLY_FILLED",
  FILLED = "FILLED",
  CANCELLED = "CANCELLED",
  EXPIRED = "EXPIRED",
  FAILED = "FAILED",
}

/**
 * Base intent structure - defines WHAT user wants, not HOW to achieve it
 */
export interface BaseIntent {
  intentId: string;
  sessionId: string;
  type: IntentType;
  status: IntentStatus;
  createdAt: number;
  expiresAt: number;
  userSignature: string;
  constraints: IntentConstraints;
}

/**
 * Constraints that must be satisfied for intent fulfillment
 */
export interface IntentConstraints {
  maxSlippageBps: number; // Max slippage in basis points
  minOutputAmount?: bigint; // Minimum output (for swaps)
  maxInputAmount?: bigint; // Maximum input (for swaps)
  deadline: number; // Unix timestamp
  allowPartialFill: boolean;
  preferredRoutes?: string[]; // Preferred DEX/routes
  excludedPools?: string[]; // Pools to avoid
}

// ============================================================================
// SWAP INTENT TYPES
// ============================================================================

/**
 * Exact input swap intent - "I want to swap exactly X of token A"
 */
export interface ExactInputSwapIntent extends BaseIntent {
  type: IntentType.EXACT_INPUT_SWAP;
  tokenIn: Token;
  tokenOut: Token;
  amountIn: bigint;
  minAmountOut: bigint;
}

/**
 * Exact output swap intent - "I want to receive exactly Y of token B"
 */
export interface ExactOutputSwapIntent extends BaseIntent {
  type: IntentType.EXACT_OUTPUT_SWAP;
  tokenIn: Token;
  tokenOut: Token;
  amountOut: bigint;
  maxAmountIn: bigint;
}

/**
 * Limit order intent - execute when price reaches target
 */
export interface LimitOrderIntent extends BaseIntent {
  type: IntentType.LIMIT_ORDER;
  tokenIn: Token;
  tokenOut: Token;
  amountIn: bigint;
  targetPrice: bigint; // Price at which to execute (scaled by 1e18)
  direction: "BUY" | "SELL";
}

/**
 * TWAP order - execute over time to minimize price impact
 */
export interface TWAPOrderIntent extends BaseIntent {
  type: IntentType.TWAP_ORDER;
  tokenIn: Token;
  tokenOut: Token;
  totalAmount: bigint;
  numIntervals: number;
  intervalDuration: number; // seconds
  executedIntervals: number;
  executedAmount: bigint;
}

/**
 * Multi-hop swap through multiple pools
 */
export interface MultiHopSwapIntent extends BaseIntent {
  type: IntentType.MULTI_HOP_SWAP;
  path: Token[];
  amountIn: bigint;
  minAmountOut: bigint;
}

/**
 * Cross-DEX swap using LI.FI routing
 */
export interface CrossDexSwapIntent extends BaseIntent {
  type: IntentType.CROSS_DEX_SWAP;
  sourceChain: number;
  destChain: number;
  tokenIn: Token;
  tokenOut: Token;
  amountIn: bigint;
  minAmountOut: bigint;
  bridgePreference?: "FASTEST" | "CHEAPEST" | "SAFEST";
}

// ============================================================================
// LIQUIDITY INTENT TYPES
// ============================================================================

/**
 * Add liquidity intent
 */
export interface AddLiquidityIntent extends BaseIntent {
  type: IntentType.ADD_LIQUIDITY;
  poolId: string;
  token0Amount: bigint;
  token1Amount: bigint;
  tickLower: number;
  tickUpper: number;
  minLiquidity: bigint;
}

/**
 * Remove liquidity intent
 */
export interface RemoveLiquidityIntent extends BaseIntent {
  type: IntentType.REMOVE_LIQUIDITY;
  positionId: string;
  liquidityToRemove: bigint; // Percentage or absolute
  minToken0: bigint;
  minToken1: bigint;
  collectFees: boolean;
}

/**
 * Rebalance position intent - automatically adjust range
 */
export interface RebalancePositionIntent extends BaseIntent {
  type: IntentType.REBALANCE_POSITION;
  positionId: string;
  newTickLower: number;
  newTickUpper: number;
  maxSlippageForRemoval: number;
  maxSlippageForAddition: number;
}

// ============================================================================
// UNION TYPES
// ============================================================================

export type SwapIntent =
  | ExactInputSwapIntent
  | ExactOutputSwapIntent
  | LimitOrderIntent
  | TWAPOrderIntent
  | MultiHopSwapIntent
  | CrossDexSwapIntent;

export type LiquidityIntent =
  | AddLiquidityIntent
  | RemoveLiquidityIntent
  | RebalancePositionIntent;

export type AMMIntent = SwapIntent | LiquidityIntent;

// ============================================================================
// EXECUTION TYPES
// ============================================================================

/**
 * Execution plan generated from intent
 */
export interface ExecutionPlan {
  planId: string;
  intentId: string;
  steps: ExecutionStep[];
  estimatedGas: bigint;
  estimatedOutput: bigint;
  priceImpact: number; // Percentage
  route: RouteSegment[];
}

/**
 * Single execution step
 */
export interface ExecutionStep {
  stepId: number;
  action: "SWAP" | "ADD_LIQUIDITY" | "REMOVE_LIQUIDITY" | "BRIDGE" | "APPROVE";
  poolId?: string;
  tokenIn?: string;
  tokenOut?: string;
  amountIn?: bigint;
  expectedAmountOut?: bigint;
  hookData?: string; // Custom hook data
}

/**
 * Route segment for multi-hop/cross-dex
 */
export interface RouteSegment {
  protocol: string; // e.g., 'uniswap-v4', 'lifi', 'sui-amm'
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  fee: number;
  liquidity: bigint;
  priceImpact: number;
}

// ============================================================================
// HOOK TYPES (UNISWAP V4)
// ============================================================================

/**
 * Hook flags following Uniswap v4 specification
 */
export interface HookFlags {
  beforeInitialize: boolean;
  afterInitialize: boolean;
  beforeAddLiquidity: boolean;
  afterAddLiquidity: boolean;
  beforeRemoveLiquidity: boolean;
  afterRemoveLiquidity: boolean;
  beforeSwap: boolean;
  afterSwap: boolean;
  beforeDonate: boolean;
  afterDonate: boolean;
}

/**
 * Hook callback data
 */
export interface HookCallbackData {
  sessionId: string;
  intentId: string;
  hookAddress: string;
  callbackType: keyof HookFlags;
  inputData: string; // Encoded input
  outputData?: string; // Encoded output (after execution)
}

/**
 * Session-aware hook context
 */
export interface SessionHookContext {
  sessionId: string;
  userAddress: string;
  sessionNonce: number;
  cumulativeVolume: bigint;
  cumulativeFees: bigint;
  activeIntents: string[];
}

// ============================================================================
// AMM SESSION TYPES
// ============================================================================

/**
 * AMM Session extends base SessionFi session with AMM-specific data
 */
export interface AMMSession {
  sessionId: string;
  ownerAddress: string;
  ownerEns?: string;
  status: AMMSessionStatus;

  // Capital management
  lockedTokens: Map<string, bigint>; // token address -> amount
  availableTokens: Map<string, bigint>; // Available for new intents

  // Intent tracking
  activeIntents: AMMIntent[];
  completedIntents: AMMIntent[];
  pendingIntents: AMMIntent[];

  // Position tracking
  liquidityPositions: LiquidityPosition[];

  // Session metrics
  totalSwapVolume: bigint;
  totalFeesGenerated: bigint;
  totalGasSaved: bigint; // Estimated gas saved vs on-chain

  // Timestamps
  createdAt: number;
  lastActivityAt: number;
  expiresAt: number;

  // Cryptographic state
  stateHash: string;
  nonce: number;
  userSignature: string;
  engineSignature: string;
}

export enum AMMSessionStatus {
  PENDING_ACTIVATION = "PENDING_ACTIVATION",
  ACTIVE = "ACTIVE",
  PAUSED = "PAUSED",
  SETTLING = "SETTLING",
  SETTLED = "SETTLED",
  DISPUTED = "DISPUTED",
  EXPIRED = "EXPIRED",
}

// ============================================================================
// SETTLEMENT TYPES
// ============================================================================

/**
 * AMM settlement proof for Sui
 */
export interface AMMSettlementProof {
  sessionId: string;
  finalStateHash: string;

  // Token settlements
  tokenSettlements: TokenSettlement[];

  // Position settlements
  positionSettlements: PositionSettlement[];

  // Intent execution proofs
  intentProofs: IntentExecutionProof[];

  // Aggregate metrics
  totalVolume: bigint;
  totalFees: bigint;
  totalIntentsExecuted: number;

  // Signatures
  userSignature: string;
  engineSignature: string;

  // Merkle proofs for efficient verification
  stateRoot: string;
  intentRoot: string;
  positionRoot: string;
}

export interface TokenSettlement {
  tokenAddress: string;
  initialAmount: bigint;
  finalAmount: bigint;
  netChange: bigint;
}

export interface PositionSettlement {
  positionId: string;
  poolId: string;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  feesEarned0: bigint;
  feesEarned1: bigint;
}

export interface IntentExecutionProof {
  intentId: string;
  intentType: IntentType;
  status: IntentStatus;
  inputAmount: bigint;
  outputAmount: bigint;
  executionPrice: bigint;
  timestamp: number;
  txHash?: string; // If executed on-chain
}

// ============================================================================
// QUOTE TYPES
// ============================================================================

/**
 * Quote request for intent execution
 */
export interface QuoteRequest {
  intentType: IntentType;
  tokenIn: Token;
  tokenOut: Token;
  amount: bigint;
  isExactInput: boolean;
  includeRoutes: boolean;
  includeLiFi: boolean;
}

/**
 * Quote response with execution details
 */
export interface QuoteResponse {
  quoteId: string;
  amountIn: bigint;
  amountOut: bigint;
  priceImpact: number;
  estimatedGas: bigint;
  route: RouteSegment[];
  expiresAt: number;

  // Alternative routes
  alternatives?: {
    route: RouteSegment[];
    amountOut: bigint;
    priceImpact: number;
  }[];
}

// ============================================================================
// EVENT TYPES
// ============================================================================

export enum AMMEventType {
  SESSION_CREATED = "SESSION_CREATED",
  SESSION_ACTIVATED = "SESSION_ACTIVATED",
  INTENT_SUBMITTED = "INTENT_SUBMITTED",
  INTENT_VALIDATED = "INTENT_VALIDATED",
  INTENT_EXECUTING = "INTENT_EXECUTING",
  INTENT_FILLED = "INTENT_FILLED",
  INTENT_PARTIALLY_FILLED = "INTENT_PARTIALLY_FILLED",
  INTENT_CANCELLED = "INTENT_CANCELLED",
  INTENT_FAILED = "INTENT_FAILED",
  POSITION_OPENED = "POSITION_OPENED",
  POSITION_MODIFIED = "POSITION_MODIFIED",
  POSITION_CLOSED = "POSITION_CLOSED",
  SESSION_SETTLING = "SESSION_SETTLING",
  SESSION_SETTLED = "SESSION_SETTLED",
  HOOK_EXECUTED = "HOOK_EXECUTED",
}

export interface AMMEvent {
  eventId: string;
  sessionId: string;
  type: AMMEventType;
  timestamp: number;
  data: Record<string, unknown>;
  stateHashBefore: string;
  stateHashAfter: string;
}
