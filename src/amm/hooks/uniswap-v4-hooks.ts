/**
 * Uniswap V4 Hook System for SessionFi
 *
 * Implements programmable hooks that enable session-based AMM interactions.
 * These hooks intercept and modify pool operations based on session state.
 *
 * Key Features:
 * - Session-aware swap execution
 * - Gasless liquidity operations via session batching
 * - Intent validation and execution within hooks
 * - Fee rebates for session users
 */

import {
  HookFlags,
  HookCallbackData,
  SessionHookContext,
  PoolKey,
  PoolState,
  AMMSession,
  AMMIntent,
  IntentType,
  IntentStatus,
  ExactInputSwapIntent,
  ExactOutputSwapIntent,
  AddLiquidityIntent,
  RemoveLiquidityIntent,
  Token,
} from "../types";
import { hashStringSync } from "../../crypto/browser-primitives";

// ============================================================================
// HOOK FLAGS CONFIGURATION
// ============================================================================

/**
 * SessionFi hook configuration - enables all relevant callbacks
 */
export const SESSION_HOOK_FLAGS: HookFlags = {
  beforeInitialize: false,
  afterInitialize: true, // Track new pools
  beforeAddLiquidity: true, // Validate session liquidity intents
  afterAddLiquidity: true, // Update session state
  beforeRemoveLiquidity: true, // Validate removal intents
  afterRemoveLiquidity: true, // Update session state
  beforeSwap: true, // Validate swap intents
  afterSwap: true, // Update session metrics
  beforeDonate: false,
  afterDonate: false,
};

// ============================================================================
// HOOK ADDRESS DERIVATION
// ============================================================================

/**
 * Derive hook address from flags (simulates Uniswap v4's address-based flags)
 * In v4, hook flags are encoded in the hook contract address
 */
export function deriveHookAddress(flags: HookFlags): string {
  let flagBits = 0;

  if (flags.beforeInitialize) flagBits |= 1 << 0;
  if (flags.afterInitialize) flagBits |= 1 << 1;
  if (flags.beforeAddLiquidity) flagBits |= 1 << 2;
  if (flags.afterAddLiquidity) flagBits |= 1 << 3;
  if (flags.beforeRemoveLiquidity) flagBits |= 1 << 4;
  if (flags.afterRemoveLiquidity) flagBits |= 1 << 5;
  if (flags.beforeSwap) flagBits |= 1 << 6;
  if (flags.afterSwap) flagBits |= 1 << 7;
  if (flags.beforeDonate) flagBits |= 1 << 8;
  if (flags.afterDonate) flagBits |= 1 << 9;

  // Generate address with flag bits in the last byte
  const baseHash = hashStringSync("sessionfi-hook-v1");
  const addressHex =
    baseHash.substring(0, 38) + flagBits.toString(16).padStart(4, "0");

  return "0x" + addressHex;
}

// ============================================================================
// SESSION HOOK MANAGER
// ============================================================================

/**
 * SessionHookManager coordinates hook callbacks with session state
 */
export class SessionHookManager {
  private activeSessions: Map<string, AMMSession> = new Map();
  private hookAddress: string;
  private poolStates: Map<string, PoolState> = new Map();

  constructor() {
    this.hookAddress = deriveHookAddress(SESSION_HOOK_FLAGS);
  }

  getHookAddress(): string {
    return this.hookAddress;
  }

  // ==========================================================================
  // SESSION MANAGEMENT
  // ==========================================================================

  registerSession(session: AMMSession): void {
    this.activeSessions.set(session.sessionId, session);
  }

  getSession(sessionId: string): AMMSession | undefined {
    return this.activeSessions.get(sessionId);
  }

  updateSession(session: AMMSession): void {
    this.activeSessions.set(session.sessionId, session);
  }

  // ==========================================================================
  // SWAP HOOKS
  // ==========================================================================

  /**
   * beforeSwap - Validates swap against session intent
   * Returns: (amountToSwap, hookData) or throws on invalid
   */
  beforeSwap(
    sessionId: string,
    poolKey: PoolKey,
    zeroForOne: boolean,
    amountSpecified: bigint,
    sqrtPriceLimitX96: bigint,
  ): BeforeSwapResult {
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      throw new Error("Session not found");
    }

    // Find matching swap intent
    const swapIntent = this.findMatchingSwapIntent(
      session,
      poolKey,
      zeroForOne,
      amountSpecified,
    );

    if (!swapIntent) {
      throw new Error("No matching intent for swap");
    }

    // Validate constraints
    this.validateSwapConstraints(swapIntent, sqrtPriceLimitX96);

    // Calculate session-specific adjustments (e.g., fee rebates)
    const adjustedAmount = this.calculateSessionAdjustedAmount(
      session,
      amountSpecified,
    );

    // Create hook callback data
    const hookData: HookCallbackData = {
      sessionId,
      intentId: swapIntent.intentId,
      hookAddress: this.hookAddress,
      callbackType: "beforeSwap",
      inputData: this.encodeSwapData(zeroForOne, amountSpecified),
    };

    return {
      success: true,
      adjustedAmount,
      hookData,
      feeOverride: this.getSessionFeeOverride(session),
    };
  }

  /**
   * afterSwap - Updates session state after swap execution
   */
  afterSwap(
    sessionId: string,
    poolKey: PoolKey,
    zeroForOne: boolean,
    amountIn: bigint,
    amountOut: bigint,
    hookData: HookCallbackData,
  ): AfterSwapResult {
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      throw new Error("Session not found");
    }

    // Update session metrics
    session.totalSwapVolume += amountIn > 0n ? amountIn : -amountIn;
    session.lastActivityAt = Date.now();
    session.nonce++;

    // Update intent status
    const intent = session.activeIntents.find(
      (i) => i.intentId === hookData.intentId,
    );

    if (intent && this.isSwapIntent(intent)) {
      intent.status = IntentStatus.FILLED;
      // Move to completed
      session.activeIntents = session.activeIntents.filter(
        (i) => i.intentId !== intent.intentId,
      );
      session.completedIntents.push(intent);
    }

    // Calculate gas saved (estimated)
    const estimatedOnChainGas = BigInt(150000); // Typical swap gas
    session.totalGasSaved += estimatedOnChainGas;

    // Update session state hash
    session.stateHash = this.computeSessionStateHash(session);

    this.updateSession(session);

    return {
      success: true,
      amountIn,
      amountOut,
      newSessionNonce: session.nonce,
      newStateHash: session.stateHash,
    };
  }

  // ==========================================================================
  // LIQUIDITY HOOKS
  // ==========================================================================

  /**
   * beforeAddLiquidity - Validates liquidity addition against session intent
   */
  beforeAddLiquidity(
    sessionId: string,
    poolKey: PoolKey,
    tickLower: number,
    tickUpper: number,
    liquidityDelta: bigint,
  ): BeforeLiquidityResult {
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      throw new Error("Session not found");
    }

    // Find matching add liquidity intent
    const liquidityIntent = this.findMatchingLiquidityIntent(
      session,
      poolKey,
      tickLower,
      tickUpper,
      liquidityDelta,
    );

    if (!liquidityIntent) {
      throw new Error("No matching intent for liquidity addition");
    }

    // Validate token availability in session
    this.validateSessionTokenAvailability(
      session,
      poolKey.currency0,
      poolKey.currency1,
      liquidityDelta,
    );

    const hookData: HookCallbackData = {
      sessionId,
      intentId: liquidityIntent.intentId,
      hookAddress: this.hookAddress,
      callbackType: "beforeAddLiquidity",
      inputData: this.encodeLiquidityData(tickLower, tickUpper, liquidityDelta),
    };

    return {
      success: true,
      hookData,
    };
  }

  /**
   * afterAddLiquidity - Creates position in session state
   */
  afterAddLiquidity(
    sessionId: string,
    poolKey: PoolKey,
    tickLower: number,
    tickUpper: number,
    liquidity: bigint,
    amount0: bigint,
    amount1: bigint,
    hookData: HookCallbackData,
  ): AfterLiquidityResult {
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      throw new Error("Session not found");
    }

    // Create position ID
    const positionId = this.generatePositionId(
      sessionId,
      poolKey,
      tickLower,
      tickUpper,
    );

    // Add position to session
    session.liquidityPositions.push({
      positionId,
      poolId: this.getPoolId(poolKey),
      owner: session.ownerAddress,
      tickLower,
      tickUpper,
      liquidity,
      feeGrowthInside0LastX128: BigInt(0),
      feeGrowthInside1LastX128: BigInt(0),
      tokensOwed0: BigInt(0),
      tokensOwed1: BigInt(0),
    });

    // Update available tokens
    const available0 =
      session.availableTokens.get(poolKey.currency0) || BigInt(0);
    const available1 =
      session.availableTokens.get(poolKey.currency1) || BigInt(0);
    session.availableTokens.set(poolKey.currency0, available0 - amount0);
    session.availableTokens.set(poolKey.currency1, available1 - amount1);

    // Update intent status
    const intent = session.activeIntents.find(
      (i) => i.intentId === hookData.intentId,
    ) as AddLiquidityIntent | undefined;

    if (intent) {
      intent.status = IntentStatus.FILLED;
      session.activeIntents = session.activeIntents.filter(
        (i) => i.intentId !== intent.intentId,
      );
      session.completedIntents.push(intent);
    }

    session.nonce++;
    session.lastActivityAt = Date.now();
    session.stateHash = this.computeSessionStateHash(session);

    this.updateSession(session);

    return {
      success: true,
      positionId,
      liquidity,
      amount0Used: amount0,
      amount1Used: amount1,
      newSessionNonce: session.nonce,
    };
  }

  /**
   * beforeRemoveLiquidity - Validates removal against session intent
   */
  beforeRemoveLiquidity(
    sessionId: string,
    poolKey: PoolKey,
    tickLower: number,
    tickUpper: number,
    liquidityDelta: bigint,
  ): BeforeLiquidityResult {
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      throw new Error("Session not found");
    }

    // Find position
    const positionId = this.generatePositionId(
      sessionId,
      poolKey,
      tickLower,
      tickUpper,
    );

    const position = session.liquidityPositions.find(
      (p) => p.positionId === positionId,
    );

    if (!position) {
      throw new Error("Position not found");
    }

    if (position.liquidity < liquidityDelta) {
      throw new Error("Insufficient liquidity in position");
    }

    // Find matching removal intent
    const removalIntent = session.activeIntents.find(
      (i) =>
        i.type === IntentType.REMOVE_LIQUIDITY &&
        (i as RemoveLiquidityIntent).positionId === positionId,
    );

    if (!removalIntent) {
      throw new Error("No matching intent for liquidity removal");
    }

    const hookData: HookCallbackData = {
      sessionId,
      intentId: removalIntent.intentId,
      hookAddress: this.hookAddress,
      callbackType: "beforeRemoveLiquidity",
      inputData: this.encodeLiquidityData(
        tickLower,
        tickUpper,
        -liquidityDelta,
      ),
    };

    return {
      success: true,
      hookData,
    };
  }

  /**
   * afterRemoveLiquidity - Updates position and returns tokens to session
   */
  afterRemoveLiquidity(
    sessionId: string,
    poolKey: PoolKey,
    tickLower: number,
    tickUpper: number,
    liquidity: bigint,
    amount0: bigint,
    amount1: bigint,
    hookData: HookCallbackData,
  ): AfterLiquidityResult {
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      throw new Error("Session not found");
    }

    const positionId = this.generatePositionId(
      sessionId,
      poolKey,
      tickLower,
      tickUpper,
    );

    // Update position
    const positionIndex = session.liquidityPositions.findIndex(
      (p) => p.positionId === positionId,
    );

    if (positionIndex >= 0) {
      const position = session.liquidityPositions[positionIndex];
      position.liquidity -= liquidity;

      // Remove position if fully withdrawn
      if (position.liquidity === BigInt(0)) {
        session.liquidityPositions.splice(positionIndex, 1);
      }
    }

    // Return tokens to available balance
    const available0 =
      session.availableTokens.get(poolKey.currency0) || BigInt(0);
    const available1 =
      session.availableTokens.get(poolKey.currency1) || BigInt(0);
    session.availableTokens.set(poolKey.currency0, available0 + amount0);
    session.availableTokens.set(poolKey.currency1, available1 + amount1);

    // Update intent status
    const intent = session.activeIntents.find(
      (i) => i.intentId === hookData.intentId,
    );

    if (intent) {
      intent.status = IntentStatus.FILLED;
      session.activeIntents = session.activeIntents.filter(
        (i) => i.intentId !== intent.intentId,
      );
      session.completedIntents.push(intent);
    }

    session.nonce++;
    session.lastActivityAt = Date.now();
    session.stateHash = this.computeSessionStateHash(session);

    this.updateSession(session);

    return {
      success: true,
      positionId,
      liquidity,
      amount0Used: amount0,
      amount1Used: amount1,
      newSessionNonce: session.nonce,
    };
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================

  private findMatchingSwapIntent(
    session: AMMSession,
    poolKey: PoolKey,
    zeroForOne: boolean,
    amountSpecified: bigint,
  ): ExactInputSwapIntent | ExactOutputSwapIntent | undefined {
    return session.activeIntents.find((intent) => {
      if (
        intent.type !== IntentType.EXACT_INPUT_SWAP &&
        intent.type !== IntentType.EXACT_OUTPUT_SWAP
      ) {
        return false;
      }

      const swapIntent = intent as ExactInputSwapIntent | ExactOutputSwapIntent;
      const tokenInMatch = zeroForOne
        ? swapIntent.tokenIn.address === poolKey.currency0
        : swapIntent.tokenIn.address === poolKey.currency1;

      return tokenInMatch && intent.status === IntentStatus.PENDING;
    }) as ExactInputSwapIntent | ExactOutputSwapIntent | undefined;
  }

  private findMatchingLiquidityIntent(
    session: AMMSession,
    poolKey: PoolKey,
    tickLower: number,
    tickUpper: number,
    liquidityDelta: bigint,
  ): AddLiquidityIntent | undefined {
    return session.activeIntents.find((intent) => {
      if (intent.type !== IntentType.ADD_LIQUIDITY) {
        return false;
      }

      const liqIntent = intent as AddLiquidityIntent;
      return (
        liqIntent.poolId === this.getPoolId(poolKey) &&
        liqIntent.tickLower === tickLower &&
        liqIntent.tickUpper === tickUpper &&
        intent.status === IntentStatus.PENDING
      );
    }) as AddLiquidityIntent | undefined;
  }

  private validateSwapConstraints(
    intent: ExactInputSwapIntent | ExactOutputSwapIntent,
    sqrtPriceLimitX96: bigint,
  ): void {
    // Check deadline
    if (intent.constraints.deadline < Date.now()) {
      throw new Error("Intent expired");
    }

    // Additional constraint checks can be added here
  }

  private validateSessionTokenAvailability(
    session: AMMSession,
    token0: string,
    token1: string,
    liquidityDelta: bigint,
  ): void {
    // In production, would calculate exact token amounts needed
    // For MVP, just check if tokens are available
    const available0 = session.availableTokens.get(token0) || BigInt(0);
    const available1 = session.availableTokens.get(token1) || BigInt(0);

    if (available0 <= BigInt(0) || available1 <= BigInt(0)) {
      throw new Error("Insufficient tokens for liquidity provision");
    }
  }

  private calculateSessionAdjustedAmount(
    session: AMMSession,
    amount: bigint,
  ): bigint {
    // Could apply session-specific adjustments like volume discounts
    return amount;
  }

  private getSessionFeeOverride(session: AMMSession): number | undefined {
    // High volume sessions could get fee discounts
    if (session.totalSwapVolume > BigInt(1000000000000)) {
      // >$1M volume
      return 2500; // 0.25% instead of 0.30%
    }
    return undefined;
  }

  private isSwapIntent(
    intent: AMMIntent,
  ): intent is ExactInputSwapIntent | ExactOutputSwapIntent {
    return (
      intent.type === IntentType.EXACT_INPUT_SWAP ||
      intent.type === IntentType.EXACT_OUTPUT_SWAP
    );
  }

  private getPoolId(poolKey: PoolKey): string {
    return hashStringSync(
      `${poolKey.currency0}:${poolKey.currency1}:${poolKey.fee}:${poolKey.tickSpacing}:${poolKey.hooks}`,
    );
  }

  private generatePositionId(
    sessionId: string,
    poolKey: PoolKey,
    tickLower: number,
    tickUpper: number,
  ): string {
    return hashStringSync(
      `pos:${sessionId}:${this.getPoolId(poolKey)}:${tickLower}:${tickUpper}`,
    );
  }

  private computeSessionStateHash(session: AMMSession): string {
    const stateData = {
      sessionId: session.sessionId,
      nonce: session.nonce,
      availableTokens: Array.from(session.availableTokens.entries()),
      activeIntents: session.activeIntents.map((i) => i.intentId),
      positions: session.liquidityPositions.map((p) => p.positionId),
      volume: session.totalSwapVolume.toString(),
    };

    return hashStringSync(JSON.stringify(stateData));
  }

  private encodeSwapData(zeroForOne: boolean, amount: bigint): string {
    return `swap:${zeroForOne}:${amount.toString()}`;
  }

  private encodeLiquidityData(
    tickLower: number,
    tickUpper: number,
    liquidity: bigint,
  ): string {
    return `liq:${tickLower}:${tickUpper}:${liquidity.toString()}`;
  }
}

// ============================================================================
// RESULT TYPES
// ============================================================================

export interface BeforeSwapResult {
  success: boolean;
  adjustedAmount: bigint;
  hookData: HookCallbackData;
  feeOverride?: number;
}

export interface AfterSwapResult {
  success: boolean;
  amountIn: bigint;
  amountOut: bigint;
  newSessionNonce: number;
  newStateHash: string;
}

export interface BeforeLiquidityResult {
  success: boolean;
  hookData: HookCallbackData;
}

export interface AfterLiquidityResult {
  success: boolean;
  positionId: string;
  liquidity: bigint;
  amount0Used: bigint;
  amount1Used: bigint;
  newSessionNonce: number;
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const sessionHookManager = new SessionHookManager();
