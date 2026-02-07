/**
 * LI.FI Integration Types
 *
 * Type definitions for LI.FI SDK integration.
 */

// ============================================================================
// CHAIN TYPES
// ============================================================================

/**
 * Supported chains for cross-chain operations
 */
export enum LiFiChainId {
  ETHEREUM = 1,
  OPTIMISM = 10,
  BSC = 56,
  POLYGON = 137,
  FANTOM = 250,
  ARBITRUM = 42161,
  AVALANCHE = 43114,
  BASE = 8453,
  ZKSYNC = 324,
  LINEA = 59144,
  SCROLL = 534352,
  // Testnets
  SEPOLIA = 11155111,
  ARBITRUM_SEPOLIA = 421614,
  OPTIMISM_SEPOLIA = 11155420,
}

/**
 * Chain information
 */
export interface ChainInfo {
  id: number;
  name: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: string[];
  blockExplorerUrls: string[];
  logoUri?: string;
}

// ============================================================================
// TOKEN TYPES
// ============================================================================

/**
 * Token information from LI.FI
 */
export interface LiFiToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  chainId: number;
  logoURI?: string;
  priceUSD?: string;
}

// ============================================================================
// ROUTE TYPES
// ============================================================================

/**
 * Route request configuration
 */
export interface LiFiRouteRequest {
  fromChainId: number;
  toChainId: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  fromAmount: string;
  fromAddress: string;
  toAddress?: string;
  options?: LiFiRouteOptions;
}

/**
 * Route options
 */
export interface LiFiRouteOptions {
  slippage?: number; // Decimal (e.g., 0.005 for 0.5%)
  order?: "RECOMMENDED" | "FASTEST" | "CHEAPEST" | "SAFEST";
  allowSwitchChain?: boolean;
  bridges?: {
    allow?: string[];
    deny?: string[];
  };
  exchanges?: {
    allow?: string[];
    deny?: string[];
  };
  integrator?: string;
  fee?: number;
  referrer?: string;
}

/**
 * Route step action
 */
export interface LiFiStepAction {
  fromChainId: number;
  toChainId: number;
  fromToken: LiFiToken;
  toToken: LiFiToken;
  fromAmount: string;
  slippage: number;
  fromAddress: string;
  toAddress: string;
}

/**
 * Route step estimate
 */
export interface LiFiStepEstimate {
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  approvalAddress: string;
  executionDuration: number;
  feeCosts?: {
    name: string;
    description?: string;
    percentage?: string;
    token: LiFiToken;
    amount: string;
    amountUSD?: string;
  }[];
  gasCosts?: {
    type: string;
    price?: string;
    estimate?: string;
    limit?: string;
    amount: string;
    amountUSD?: string;
    token: LiFiToken;
  }[];
}

/**
 * Single step in a route
 */
export interface LiFiStep {
  id: string;
  type: "swap" | "cross" | "lifi";
  tool: string;
  toolDetails: {
    key: string;
    name: string;
    logoURI?: string;
  };
  action: LiFiStepAction;
  estimate: LiFiStepEstimate;
  integrator?: string;
  execution?: LiFiStepExecution;
}

/**
 * Step execution status
 */
export interface LiFiStepExecution {
  status:
    | "NOT_STARTED"
    | "STARTED"
    | "ACTION_REQUIRED"
    | "PENDING"
    | "DONE"
    | "FAILED";
  process?: LiFiExecutionProcess[];
}

/**
 * Execution process details
 */
export interface LiFiExecutionProcess {
  type: "STARTED" | "ACTION_REQUIRED" | "PENDING" | "DONE" | "FAILED";
  startedAt?: number;
  doneAt?: number;
  txHash?: string;
  txLink?: string;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Complete route information
 */
export interface LiFiRoute {
  id: string;
  fromChainId: number;
  toChainId: number;
  fromToken: LiFiToken;
  toToken: LiFiToken;
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  gasCostUSD?: string;
  steps: LiFiStep[];
  tags?: string[];
}

// ============================================================================
// QUOTE TYPES
// ============================================================================

/**
 * Quote response
 */
export interface LiFiQuoteResponse {
  routes: LiFiRoute[];
  fromChainId: number;
  toChainId: number;
  fromToken: LiFiToken;
  toToken: LiFiToken;
  fromAmount: string;
}

// ============================================================================
// EXECUTION TYPES
// ============================================================================

/**
 * Route execution config
 */
export interface ExecutionConfig {
  updateRouteHook?: (updatedRoute: LiFiRoute) => void;
  acceptSlippageUpdateHook?: (params: {
    oldSlippage: number;
    newSlippage: number;
  }) => Promise<boolean>;
  acceptExchangeRateUpdateHook?: (params: {
    oldToAmount: string;
    newToAmount: string;
    toToken: LiFiToken;
  }) => Promise<boolean>;
  infiniteApproval?: boolean;
}

/**
 * Execution result
 */
export interface ExecutionResult {
  success: boolean;
  route: LiFiRoute;
  error?: string;
  txHash?: string;
  toAmount?: string;
}

// ============================================================================
// SESSION INTEGRATION TYPES
// ============================================================================

/**
 * Session swap request
 */
export interface SessionSwapRequest {
  sessionId: string;
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  slippage?: number;
  orderPreference?: "RECOMMENDED" | "FASTEST" | "CHEAPEST" | "SAFEST";
}

/**
 * Session swap result
 */
export interface SessionSwapResult {
  success: boolean;
  swapId: string;
  route?: LiFiRoute;
  estimatedOutput?: string;
  estimatedDuration?: number;
  gasCostUSD?: string;
  error?: string;
  txHash?: string;
}

/**
 * Supported bridge
 */
export type SupportedBridge =
  | "stargate"
  | "across"
  | "hop"
  | "cbridge"
  | "multichain"
  | "connext"
  | "hyphen"
  | "polygon"
  | "arbitrum"
  | "optimism";

/**
 * Supported DEX
 */
export type SupportedDex =
  | "uniswap"
  | "sushiswap"
  | "1inch"
  | "paraswap"
  | "0x"
  | "kyberswap"
  | "curve"
  | "balancer"
  | "pancakeswap";
