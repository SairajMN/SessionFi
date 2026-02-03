/**
 * Intent-Based Swap Engine
 *
 * Core engine that processes user intents and converts them into executable
 * AMM operations. Handles intent validation, routing, and execution.
 *
 * Key Features:
 * - Intent parsing and validation
 * - Optimal route finding across pools
 * - Slippage protection
 * - Partial fill support
 * - Session state management
 */

import {
  AMMSession,
  AMMSessionStatus,
  AMMIntent,
  IntentType,
  IntentStatus,
  IntentConstraints,
  ExactInputSwapIntent,
  ExactOutputSwapIntent,
  LimitOrderIntent,
  TWAPOrderIntent,
  MultiHopSwapIntent,
  AddLiquidityIntent,
  RemoveLiquidityIntent,
  Token,
  PoolKey,
  PoolState,
  ExecutionPlan,
  ExecutionStep,
  RouteSegment,
  QuoteRequest,
  QuoteResponse,
  AMMEvent,
  AMMEventType,
  LiquidityPosition,
} from "../types";
import { hashStringSync } from "../../crypto/browser-primitives";
import {
  SessionHookManager,
  sessionHookManager,
} from "../hooks/uniswap-v4-hooks";

// ============================================================================
// INTENT ENGINE
// ============================================================================

/**
 * IntentEngine processes and executes user intents within AMM sessions
 */
export class IntentEngine {
  private hookManager: SessionHookManager;
  private pools: Map<string, PoolState> = new Map();
  private priceOracle: Map<string, bigint> = new Map(); // token -> price in USD (1e18)

  constructor(hookManager: SessionHookManager = sessionHookManager) {
    this.hookManager = hookManager;
    this.initializeDemoPools();
    this.initializePriceOracle();
  }

  // ==========================================================================
  // SESSION MANAGEMENT
  // ==========================================================================

  /**
   * Create a new AMM session
   */
  createSession(
    ownerAddress: string,
    ownerEns: string | undefined,
    lockedTokens: Map<string, bigint>,
    expiresAt: number,
  ): AMMSession {
    const sessionId = this.generateSessionId(ownerAddress, lockedTokens);
    const now = Date.now();

    const session: AMMSession = {
      sessionId,
      ownerAddress,
      ownerEns,
      status: AMMSessionStatus.ACTIVE,
      lockedTokens: new Map(lockedTokens),
      availableTokens: new Map(lockedTokens), // Initially all tokens available
      activeIntents: [],
      completedIntents: [],
      pendingIntents: [],
      liquidityPositions: [],
      totalSwapVolume: BigInt(0),
      totalFeesGenerated: BigInt(0),
      totalGasSaved: BigInt(0),
      createdAt: now,
      lastActivityAt: now,
      expiresAt,
      stateHash: "",
      nonce: 0,
      userSignature: "",
      engineSignature: "",
    };

    // Compute initial state hash
    session.stateHash = this.computeSessionStateHash(session);

    // Register with hook manager
    this.hookManager.registerSession(session);

    return session;
  }

  // ==========================================================================
  // INTENT CREATION
  // ==========================================================================

  /**
   * Create an exact input swap intent
   */
  createExactInputSwapIntent(
    session: AMMSession,
    tokenIn: Token,
    tokenOut: Token,
    amountIn: bigint,
    minAmountOut: bigint,
    constraints: Partial<IntentConstraints>,
  ): ExactInputSwapIntent {
    const intent: ExactInputSwapIntent = {
      intentId: this.generateIntentId(
        session.sessionId,
        IntentType.EXACT_INPUT_SWAP,
      ),
      sessionId: session.sessionId,
      type: IntentType.EXACT_INPUT_SWAP,
      status: IntentStatus.PENDING,
      createdAt: Date.now(),
      expiresAt: constraints.deadline || Date.now() + 3600000, // 1 hour default
      userSignature: "",
      constraints: {
        maxSlippageBps: constraints.maxSlippageBps || 50, // 0.5% default
        minOutputAmount: minAmountOut,
        deadline: constraints.deadline || Date.now() + 3600000,
        allowPartialFill: constraints.allowPartialFill || false,
        preferredRoutes: constraints.preferredRoutes,
        excludedPools: constraints.excludedPools,
      },
      tokenIn,
      tokenOut,
      amountIn,
      minAmountOut,
    };

    return intent;
  }

  /**
   * Create an exact output swap intent
   */
  createExactOutputSwapIntent(
    session: AMMSession,
    tokenIn: Token,
    tokenOut: Token,
    amountOut: bigint,
    maxAmountIn: bigint,
    constraints: Partial<IntentConstraints>,
  ): ExactOutputSwapIntent {
    const intent: ExactOutputSwapIntent = {
      intentId: this.generateIntentId(
        session.sessionId,
        IntentType.EXACT_OUTPUT_SWAP,
      ),
      sessionId: session.sessionId,
      type: IntentType.EXACT_OUTPUT_SWAP,
      status: IntentStatus.PENDING,
      createdAt: Date.now(),
      expiresAt: constraints.deadline || Date.now() + 3600000,
      userSignature: "",
      constraints: {
        maxSlippageBps: constraints.maxSlippageBps || 50,
        maxInputAmount: maxAmountIn,
        deadline: constraints.deadline || Date.now() + 3600000,
        allowPartialFill: constraints.allowPartialFill || false,
        preferredRoutes: constraints.preferredRoutes,
        excludedPools: constraints.excludedPools,
      },
      tokenIn,
      tokenOut,
      amountOut,
      maxAmountIn,
    };

    return intent;
  }

  /**
   * Create a limit order intent
   */
  createLimitOrderIntent(
    session: AMMSession,
    tokenIn: Token,
    tokenOut: Token,
    amountIn: bigint,
    targetPrice: bigint,
    direction: "BUY" | "SELL",
    constraints: Partial<IntentConstraints>,
  ): LimitOrderIntent {
    const intent: LimitOrderIntent = {
      intentId: this.generateIntentId(
        session.sessionId,
        IntentType.LIMIT_ORDER,
      ),
      sessionId: session.sessionId,
      type: IntentType.LIMIT_ORDER,
      status: IntentStatus.PENDING,
      createdAt: Date.now(),
      expiresAt: constraints.deadline || Date.now() + 86400000, // 24 hours default for limit orders
      userSignature: "",
      constraints: {
        maxSlippageBps: constraints.maxSlippageBps || 10, // Tighter slippage for limit orders
        deadline: constraints.deadline || Date.now() + 86400000,
        allowPartialFill: constraints.allowPartialFill !== false, // Default true for limit orders
      },
      tokenIn,
      tokenOut,
      amountIn,
      targetPrice,
      direction,
    };

    return intent;
  }

  /**
   * Create an add liquidity intent
   */
  createAddLiquidityIntent(
    session: AMMSession,
    poolId: string,
    token0Amount: bigint,
    token1Amount: bigint,
    tickLower: number,
    tickUpper: number,
    minLiquidity: bigint,
    constraints: Partial<IntentConstraints>,
  ): AddLiquidityIntent {
    const intent: AddLiquidityIntent = {
      intentId: this.generateIntentId(
        session.sessionId,
        IntentType.ADD_LIQUIDITY,
      ),
      sessionId: session.sessionId,
      type: IntentType.ADD_LIQUIDITY,
      status: IntentStatus.PENDING,
      createdAt: Date.now(),
      expiresAt: constraints.deadline || Date.now() + 3600000,
      userSignature: "",
      constraints: {
        maxSlippageBps: constraints.maxSlippageBps || 100, // 1% default for LP
        deadline: constraints.deadline || Date.now() + 3600000,
        allowPartialFill: false,
      },
      poolId,
      token0Amount,
      token1Amount,
      tickLower,
      tickUpper,
      minLiquidity,
    };

    return intent;
  }

  /**
   * Create a remove liquidity intent
   */
  createRemoveLiquidityIntent(
    session: AMMSession,
    positionId: string,
    liquidityToRemove: bigint,
    minToken0: bigint,
    minToken1: bigint,
    collectFees: boolean,
    constraints: Partial<IntentConstraints>,
  ): RemoveLiquidityIntent {
    const intent: RemoveLiquidityIntent = {
      intentId: this.generateIntentId(
        session.sessionId,
        IntentType.REMOVE_LIQUIDITY,
      ),
      sessionId: session.sessionId,
      type: IntentType.REMOVE_LIQUIDITY,
      status: IntentStatus.PENDING,
      createdAt: Date.now(),
      expiresAt: constraints.deadline || Date.now() + 3600000,
      userSignature: "",
      constraints: {
        maxSlippageBps: constraints.maxSlippageBps || 100,
        deadline: constraints.deadline || Date.now() + 3600000,
        allowPartialFill: false,
      },
      positionId,
      liquidityToRemove,
      minToken0,
      minToken1,
      collectFees,
    };

    return intent;
  }

  // ==========================================================================
  // INTENT SUBMISSION
  // ==========================================================================

  /**
   * Submit an intent for execution
   */
  submitIntent(
    session: AMMSession,
    intent: AMMIntent,
    userSignature: string,
  ): IntentSubmissionResult {
    // Validate intent
    const validation = this.validateIntent(session, intent);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
      };
    }

    // Set user signature
    intent.userSignature = userSignature;
    intent.status = IntentStatus.VALIDATING;

    // Add to session
    session.activeIntents.push(intent);
    session.lastActivityAt = Date.now();
    session.nonce++;
    session.stateHash = this.computeSessionStateHash(session);

    // Update hook manager
    this.hookManager.updateSession(session);

    return {
      success: true,
      intentId: intent.intentId,
      estimatedExecution: this.estimateExecutionTime(intent),
    };
  }

  // ==========================================================================
  // INTENT VALIDATION
  // ==========================================================================

  /**
   * Validate an intent against session state and constraints
   */
  validateIntent(
    session: AMMSession,
    intent: AMMIntent,
  ): { valid: boolean; error?: string } {
    // Check session is active
    if (session.status !== AMMSessionStatus.ACTIVE) {
      return { valid: false, error: "Session is not active" };
    }

    // Check intent not expired
    if (intent.expiresAt < Date.now()) {
      return { valid: false, error: "Intent has expired" };
    }

    // Check deadline constraint
    if (intent.constraints.deadline < Date.now()) {
      return { valid: false, error: "Deadline has passed" };
    }

    // Type-specific validation
    switch (intent.type) {
      case IntentType.EXACT_INPUT_SWAP:
      case IntentType.EXACT_OUTPUT_SWAP:
        return this.validateSwapIntent(
          session,
          intent as ExactInputSwapIntent | ExactOutputSwapIntent,
        );

      case IntentType.LIMIT_ORDER:
        return this.validateLimitOrderIntent(
          session,
          intent as LimitOrderIntent,
        );

      case IntentType.ADD_LIQUIDITY:
        return this.validateAddLiquidityIntent(
          session,
          intent as AddLiquidityIntent,
        );

      case IntentType.REMOVE_LIQUIDITY:
        return this.validateRemoveLiquidityIntent(
          session,
          intent as RemoveLiquidityIntent,
        );

      default:
        return { valid: false, error: "Unknown intent type" };
    }
  }

  private validateSwapIntent(
    session: AMMSession,
    intent: ExactInputSwapIntent | ExactOutputSwapIntent,
  ): { valid: boolean; error?: string } {
    // Check token availability
    const tokenInAddress = intent.tokenIn.address;
    const availableAmount =
      session.availableTokens.get(tokenInAddress) || BigInt(0);

    if (intent.type === IntentType.EXACT_INPUT_SWAP) {
      const exactInputIntent = intent as ExactInputSwapIntent;
      if (availableAmount < exactInputIntent.amountIn) {
        return {
          valid: false,
          error: `Insufficient ${intent.tokenIn.symbol}: have ${availableAmount}, need ${exactInputIntent.amountIn}`,
        };
      }
    } else {
      const exactOutputIntent = intent as ExactOutputSwapIntent;
      if (availableAmount < exactOutputIntent.maxAmountIn) {
        return {
          valid: false,
          error: `Insufficient ${intent.tokenIn.symbol}: have ${availableAmount}, need up to ${exactOutputIntent.maxAmountIn}`,
        };
      }
    }

    // Check pool exists
    const pool = this.findPoolForPair(
      intent.tokenIn.address,
      intent.tokenOut.address,
    );
    if (!pool) {
      return { valid: false, error: "No pool found for token pair" };
    }

    return { valid: true };
  }

  private validateLimitOrderIntent(
    session: AMMSession,
    intent: LimitOrderIntent,
  ): { valid: boolean; error?: string } {
    // Check token availability
    const availableAmount =
      session.availableTokens.get(intent.tokenIn.address) || BigInt(0);

    if (availableAmount < intent.amountIn) {
      return {
        valid: false,
        error: `Insufficient ${intent.tokenIn.symbol} for limit order`,
      };
    }

    // Check price is reasonable (within 50% of current)
    const currentPrice = this.getCurrentPrice(
      intent.tokenIn.address,
      intent.tokenOut.address,
    );
    if (currentPrice > BigInt(0)) {
      const priceDiff =
        intent.targetPrice > currentPrice
          ? intent.targetPrice - currentPrice
          : currentPrice - intent.targetPrice;
      const maxDiff = currentPrice / BigInt(2); // 50%

      if (priceDiff > maxDiff) {
        return {
          valid: false,
          error: "Target price too far from current price",
        };
      }
    }

    return { valid: true };
  }

  private validateAddLiquidityIntent(
    session: AMMSession,
    intent: AddLiquidityIntent,
  ): { valid: boolean; error?: string } {
    const pool = this.pools.get(intent.poolId);
    if (!pool) {
      return { valid: false, error: "Pool not found" };
    }

    // Check tick range is valid
    if (intent.tickLower >= intent.tickUpper) {
      return { valid: false, error: "Invalid tick range" };
    }

    // Check tick spacing
    const tickSpacing = pool.poolKey.tickSpacing;
    if (
      intent.tickLower % tickSpacing !== 0 ||
      intent.tickUpper % tickSpacing !== 0
    ) {
      return { valid: false, error: "Ticks must be multiples of tick spacing" };
    }

    // Check token availability
    const available0 =
      session.availableTokens.get(pool.poolKey.currency0) || BigInt(0);
    const available1 =
      session.availableTokens.get(pool.poolKey.currency1) || BigInt(0);

    if (available0 < intent.token0Amount || available1 < intent.token1Amount) {
      return { valid: false, error: "Insufficient tokens for liquidity" };
    }

    return { valid: true };
  }

  private validateRemoveLiquidityIntent(
    session: AMMSession,
    intent: RemoveLiquidityIntent,
  ): { valid: boolean; error?: string } {
    // Find position
    const position = session.liquidityPositions.find(
      (p) => p.positionId === intent.positionId,
    );

    if (!position) {
      return { valid: false, error: "Position not found" };
    }

    if (position.liquidity < intent.liquidityToRemove) {
      return { valid: false, error: "Insufficient liquidity in position" };
    }

    return { valid: true };
  }

  // ==========================================================================
  // INTENT EXECUTION
  // ==========================================================================

  /**
   * Execute a validated intent
   */
  async executeIntent(
    session: AMMSession,
    intent: AMMIntent,
  ): Promise<IntentExecutionResult> {
    intent.status = IntentStatus.EXECUTING;

    try {
      switch (intent.type) {
        case IntentType.EXACT_INPUT_SWAP:
          return await this.executeExactInputSwap(
            session,
            intent as ExactInputSwapIntent,
          );

        case IntentType.EXACT_OUTPUT_SWAP:
          return await this.executeExactOutputSwap(
            session,
            intent as ExactOutputSwapIntent,
          );

        case IntentType.LIMIT_ORDER:
          return await this.executeLimitOrder(
            session,
            intent as LimitOrderIntent,
          );

        case IntentType.ADD_LIQUIDITY:
          return await this.executeAddLiquidity(
            session,
            intent as AddLiquidityIntent,
          );

        case IntentType.REMOVE_LIQUIDITY:
          return await this.executeRemoveLiquidity(
            session,
            intent as RemoveLiquidityIntent,
          );

        default:
          return { success: false, error: "Unknown intent type" };
      }
    } catch (error) {
      intent.status = IntentStatus.FAILED;
      return {
        success: false,
        error: error instanceof Error ? error.message : "Execution failed",
      };
    }
  }

  private async executeExactInputSwap(
    session: AMMSession,
    intent: ExactInputSwapIntent,
  ): Promise<IntentExecutionResult> {
    // Find route
    const route = this.findBestRoute(
      intent.tokenIn.address,
      intent.tokenOut.address,
      intent.amountIn,
    );

    if (!route) {
      return { success: false, error: "No route found" };
    }

    // Calculate output
    const amountOut = this.simulateSwap(route, intent.amountIn);

    // Check slippage
    if (amountOut < intent.minAmountOut) {
      return {
        success: false,
        error: `Slippage exceeded: output ${amountOut} < minimum ${intent.minAmountOut}`,
      };
    }

    // Update session balances
    const currentIn =
      session.availableTokens.get(intent.tokenIn.address) || BigInt(0);
    const currentOut =
      session.availableTokens.get(intent.tokenOut.address) || BigInt(0);
    session.availableTokens.set(
      intent.tokenIn.address,
      currentIn - intent.amountIn,
    );
    session.availableTokens.set(
      intent.tokenOut.address,
      currentOut + amountOut,
    );

    // Update metrics
    session.totalSwapVolume += intent.amountIn;
    const fee = this.calculateFee(intent.amountIn, route[0]?.fee || 3000);
    session.totalFeesGenerated += fee;
    session.totalGasSaved += BigInt(150000); // Estimated gas for on-chain swap

    // Mark intent as filled
    intent.status = IntentStatus.FILLED;

    // Move to completed
    session.activeIntents = session.activeIntents.filter(
      (i) => i.intentId !== intent.intentId,
    );
    session.completedIntents.push(intent);

    // Update session state
    session.nonce++;
    session.lastActivityAt = Date.now();
    session.stateHash = this.computeSessionStateHash(session);

    this.hookManager.updateSession(session);

    return {
      success: true,
      amountIn: intent.amountIn,
      amountOut,
      route,
      gasSaved: BigInt(150000),
    };
  }

  private async executeExactOutputSwap(
    session: AMMSession,
    intent: ExactOutputSwapIntent,
  ): Promise<IntentExecutionResult> {
    // Find route
    const route = this.findBestRoute(
      intent.tokenIn.address,
      intent.tokenOut.address,
      intent.maxAmountIn,
    );

    if (!route) {
      return { success: false, error: "No route found" };
    }

    // Calculate required input
    const amountIn = this.simulateExactOutputSwap(route, intent.amountOut);

    // Check max input
    if (amountIn > intent.maxAmountIn) {
      return {
        success: false,
        error: `Required input ${amountIn} exceeds maximum ${intent.maxAmountIn}`,
      };
    }

    // Update session balances
    const currentIn =
      session.availableTokens.get(intent.tokenIn.address) || BigInt(0);
    const currentOut =
      session.availableTokens.get(intent.tokenOut.address) || BigInt(0);
    session.availableTokens.set(intent.tokenIn.address, currentIn - amountIn);
    session.availableTokens.set(
      intent.tokenOut.address,
      currentOut + intent.amountOut,
    );

    // Update metrics
    session.totalSwapVolume += amountIn;
    const fee = this.calculateFee(amountIn, route[0]?.fee || 3000);
    session.totalFeesGenerated += fee;
    session.totalGasSaved += BigInt(150000);

    intent.status = IntentStatus.FILLED;
    session.activeIntents = session.activeIntents.filter(
      (i) => i.intentId !== intent.intentId,
    );
    session.completedIntents.push(intent);

    session.nonce++;
    session.lastActivityAt = Date.now();
    session.stateHash = this.computeSessionStateHash(session);

    this.hookManager.updateSession(session);

    return {
      success: true,
      amountIn,
      amountOut: intent.amountOut,
      route,
      gasSaved: BigInt(150000),
    };
  }

  private async executeLimitOrder(
    session: AMMSession,
    intent: LimitOrderIntent,
  ): Promise<IntentExecutionResult> {
    // Check if current price matches target
    const currentPrice = this.getCurrentPrice(
      intent.tokenIn.address,
      intent.tokenOut.address,
    );

    const canExecute =
      intent.direction === "BUY"
        ? currentPrice <= intent.targetPrice
        : currentPrice >= intent.targetPrice;

    if (!canExecute) {
      // Keep pending
      return {
        success: true,
        pending: true,
        message: `Waiting for price to reach ${intent.targetPrice} (current: ${currentPrice})`,
      };
    }

    // Execute as exact input swap
    const route = this.findBestRoute(
      intent.tokenIn.address,
      intent.tokenOut.address,
      intent.amountIn,
    );

    if (!route) {
      return { success: false, error: "No route found" };
    }

    const amountOut = this.simulateSwap(route, intent.amountIn);

    // Update balances
    const currentIn =
      session.availableTokens.get(intent.tokenIn.address) || BigInt(0);
    const currentOut =
      session.availableTokens.get(intent.tokenOut.address) || BigInt(0);
    session.availableTokens.set(
      intent.tokenIn.address,
      currentIn - intent.amountIn,
    );
    session.availableTokens.set(
      intent.tokenOut.address,
      currentOut + amountOut,
    );

    session.totalSwapVolume += intent.amountIn;
    session.totalGasSaved += BigInt(150000);

    intent.status = IntentStatus.FILLED;
    session.activeIntents = session.activeIntents.filter(
      (i) => i.intentId !== intent.intentId,
    );
    session.completedIntents.push(intent);

    session.nonce++;
    session.lastActivityAt = Date.now();
    session.stateHash = this.computeSessionStateHash(session);

    this.hookManager.updateSession(session);

    return {
      success: true,
      amountIn: intent.amountIn,
      amountOut,
      route,
      gasSaved: BigInt(150000),
    };
  }

  private async executeAddLiquidity(
    session: AMMSession,
    intent: AddLiquidityIntent,
  ): Promise<IntentExecutionResult> {
    const pool = this.pools.get(intent.poolId);
    if (!pool) {
      return { success: false, error: "Pool not found" };
    }

    // Calculate liquidity from amounts
    const liquidity = this.calculateLiquidityFromAmounts(
      pool,
      intent.tickLower,
      intent.tickUpper,
      intent.token0Amount,
      intent.token1Amount,
    );

    if (liquidity < intent.minLiquidity) {
      return { success: false, error: "Insufficient liquidity minted" };
    }

    // Deduct tokens
    const available0 =
      session.availableTokens.get(pool.poolKey.currency0) || BigInt(0);
    const available1 =
      session.availableTokens.get(pool.poolKey.currency1) || BigInt(0);
    session.availableTokens.set(
      pool.poolKey.currency0,
      available0 - intent.token0Amount,
    );
    session.availableTokens.set(
      pool.poolKey.currency1,
      available1 - intent.token1Amount,
    );

    // Create position
    const positionId = this.generatePositionId(
      session.sessionId,
      intent.poolId,
      intent.tickLower,
      intent.tickUpper,
    );
    const position: LiquidityPosition = {
      positionId,
      poolId: intent.poolId,
      owner: session.ownerAddress,
      tickLower: intent.tickLower,
      tickUpper: intent.tickUpper,
      liquidity,
      feeGrowthInside0LastX128: BigInt(0),
      feeGrowthInside1LastX128: BigInt(0),
      tokensOwed0: BigInt(0),
      tokensOwed1: BigInt(0),
    };

    session.liquidityPositions.push(position);
    session.totalGasSaved += BigInt(200000); // LP operations cost more gas

    intent.status = IntentStatus.FILLED;
    session.activeIntents = session.activeIntents.filter(
      (i) => i.intentId !== intent.intentId,
    );
    session.completedIntents.push(intent);

    session.nonce++;
    session.lastActivityAt = Date.now();
    session.stateHash = this.computeSessionStateHash(session);

    this.hookManager.updateSession(session);

    return {
      success: true,
      positionId,
      liquidity,
      amount0Used: intent.token0Amount,
      amount1Used: intent.token1Amount,
      gasSaved: BigInt(200000),
    };
  }

  private async executeRemoveLiquidity(
    session: AMMSession,
    intent: RemoveLiquidityIntent,
  ): Promise<IntentExecutionResult> {
    const positionIndex = session.liquidityPositions.findIndex(
      (p) => p.positionId === intent.positionId,
    );

    if (positionIndex < 0) {
      return { success: false, error: "Position not found" };
    }

    const position = session.liquidityPositions[positionIndex];
    const pool = this.pools.get(position.poolId);
    if (!pool) {
      return { success: false, error: "Pool not found" };
    }

    // Calculate token amounts
    const { amount0, amount1 } = this.calculateTokensFromLiquidity(
      pool,
      position.tickLower,
      position.tickUpper,
      intent.liquidityToRemove,
    );

    // Check minimum outputs
    if (amount0 < intent.minToken0 || amount1 < intent.minToken1) {
      return {
        success: false,
        error: "Slippage exceeded for liquidity removal",
      };
    }

    // Return tokens
    const available0 =
      session.availableTokens.get(pool.poolKey.currency0) || BigInt(0);
    const available1 =
      session.availableTokens.get(pool.poolKey.currency1) || BigInt(0);
    session.availableTokens.set(pool.poolKey.currency0, available0 + amount0);
    session.availableTokens.set(pool.poolKey.currency1, available1 + amount1);

    // Collect fees if requested
    let fees0 = BigInt(0);
    let fees1 = BigInt(0);
    if (intent.collectFees) {
      fees0 = position.tokensOwed0;
      fees1 = position.tokensOwed1;
      session.availableTokens.set(
        pool.poolKey.currency0,
        (session.availableTokens.get(pool.poolKey.currency0) || BigInt(0)) +
          fees0,
      );
      session.availableTokens.set(
        pool.poolKey.currency1,
        (session.availableTokens.get(pool.poolKey.currency1) || BigInt(0)) +
          fees1,
      );
    }

    // Update or remove position
    position.liquidity -= intent.liquidityToRemove;
    if (position.liquidity === BigInt(0)) {
      session.liquidityPositions.splice(positionIndex, 1);
    }

    session.totalGasSaved += BigInt(200000);

    intent.status = IntentStatus.FILLED;
    session.activeIntents = session.activeIntents.filter(
      (i) => i.intentId !== intent.intentId,
    );
    session.completedIntents.push(intent);

    session.nonce++;
    session.lastActivityAt = Date.now();
    session.stateHash = this.computeSessionStateHash(session);

    this.hookManager.updateSession(session);

    return {
      success: true,
      amount0,
      amount1,
      fees0,
      fees1,
      gasSaved: BigInt(200000),
    };
  }

  // ==========================================================================
  // QUOTING
  // ==========================================================================

  /**
   * Get quote for intent execution
   */
  getQuote(request: QuoteRequest): QuoteResponse {
    const route = this.findBestRoute(
      request.tokenIn.address,
      request.tokenOut.address,
      request.amount,
    );

    if (!route || route.length === 0) {
      return {
        quoteId: this.generateQuoteId(),
        amountIn: BigInt(0),
        amountOut: BigInt(0),
        priceImpact: 0,
        estimatedGas: BigInt(0),
        route: [],
        expiresAt: Date.now(),
      };
    }

    let amountIn: bigint;
    let amountOut: bigint;

    if (request.isExactInput) {
      amountIn = request.amount;
      amountOut = this.simulateSwap(route, amountIn);
    } else {
      amountOut = request.amount;
      amountIn = this.simulateExactOutputSwap(route, amountOut);
    }

    const priceImpact = this.calculatePriceImpact(
      request.tokenIn.address,
      request.tokenOut.address,
      amountIn,
      amountOut,
    );

    return {
      quoteId: this.generateQuoteId(),
      amountIn,
      amountOut,
      priceImpact,
      estimatedGas: BigInt(150000),
      route,
      expiresAt: Date.now() + 30000, // 30 seconds
    };
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================

  private generateSessionId(
    ownerAddress: string,
    lockedTokens: Map<string, bigint>,
  ): string {
    const tokenData = Array.from(lockedTokens.entries())
      .map(([addr, amount]) => `${addr}:${amount}`)
      .join("|");
    return hashStringSync(`session:${ownerAddress}:${Date.now()}:${tokenData}`);
  }

  private generateIntentId(sessionId: string, intentType: IntentType): string {
    return hashStringSync(
      `intent:${sessionId}:${intentType}:${Date.now()}:${Math.random()}`,
    );
  }

  private generatePositionId(
    sessionId: string,
    poolId: string,
    tickLower: number,
    tickUpper: number,
  ): string {
    return hashStringSync(
      `pos:${sessionId}:${poolId}:${tickLower}:${tickUpper}:${Date.now()}`,
    );
  }

  private generateQuoteId(): string {
    return hashStringSync(`quote:${Date.now()}:${Math.random()}`);
  }

  private computeSessionStateHash(session: AMMSession): string {
    const data = {
      sessionId: session.sessionId,
      nonce: session.nonce,
      tokens: Array.from(session.availableTokens.entries()).map(([k, v]) => [k, v.toString()]),
      activeIntents: session.activeIntents.length,
      positions: session.liquidityPositions.length,
    };
    return hashStringSync(JSON.stringify(data));
  }

  private estimateExecutionTime(intent: AMMIntent): number {
    // Immediate execution for most intents
    return intent.type === IntentType.LIMIT_ORDER ? -1 : Date.now() + 100;
  }

  // ==========================================================================
  // POOL & PRICE HELPERS
  // ==========================================================================

  private initializeDemoPools(): void {
    // Create demo pools for common pairs
    const demoPoolKeys: PoolKey[] = [
      {
        currency0: "0xUSDC",
        currency1: "0xWETH",
        fee: 3000,
        tickSpacing: 60,
        hooks: sessionHookManager.getHookAddress(),
      },
      {
        currency0: "0xUSDC",
        currency1: "0xUSDT",
        fee: 100,
        tickSpacing: 1,
        hooks: sessionHookManager.getHookAddress(),
      },
      {
        currency0: "0xWETH",
        currency1: "0xWBTC",
        fee: 3000,
        tickSpacing: 60,
        hooks: sessionHookManager.getHookAddress(),
      },
    ];

    for (const poolKey of demoPoolKeys) {
      const poolId = hashStringSync(
        `${poolKey.currency0}:${poolKey.currency1}:${poolKey.fee}`,
      );
      this.pools.set(poolId, {
        poolId,
        poolKey,
        sqrtPriceX96: BigInt("79228162514264337593543950336"), // ~1:1
        tick: 0,
        liquidity: BigInt("1000000000000000000000000"), // 1M in liquidity
        feeGrowthGlobal0X128: BigInt(0),
        feeGrowthGlobal1X128: BigInt(0),
      });
    }
  }

  private initializePriceOracle(): void {
    // Demo prices in USD (1e18 scale)
    this.priceOracle.set("0xUSDC", BigInt("1000000000000000000")); // $1
    this.priceOracle.set("0xUSDT", BigInt("1000000000000000000")); // $1
    this.priceOracle.set("0xWETH", BigInt("2500000000000000000000")); // $2500
    this.priceOracle.set("0xWBTC", BigInt("45000000000000000000000")); // $45000
  }

  private findPoolForPair(
    token0: string,
    token1: string,
  ): PoolState | undefined {
    // Sort addresses
    const [sorted0, sorted1] =
      token0 < token1 ? [token0, token1] : [token1, token0];

    for (const pool of this.pools.values()) {
      if (
        pool.poolKey.currency0 === sorted0 &&
        pool.poolKey.currency1 === sorted1
      ) {
        return pool;
      }
    }

    return undefined;
  }

  private getCurrentPrice(tokenIn: string, tokenOut: string): bigint {
    const priceIn = this.priceOracle.get(tokenIn) || BigInt(0);
    const priceOut = this.priceOracle.get(tokenOut) || BigInt(0);

    if (priceOut === BigInt(0)) return BigInt(0);

    return (priceIn * BigInt("1000000000000000000")) / priceOut;
  }

  private findBestRoute(
    tokenIn: string,
    tokenOut: string,
    amount: bigint,
  ): RouteSegment[] {
    const pool = this.findPoolForPair(tokenIn, tokenOut);

    if (pool) {
      return [
        {
          protocol: "uniswap-v4",
          poolId: pool.poolId,
          tokenIn,
          tokenOut,
          fee: pool.poolKey.fee,
          liquidity: pool.liquidity,
          priceImpact: 0.1, // Simplified
        },
      ];
    }

    // Try multi-hop through WETH
    if (tokenIn !== "0xWETH" && tokenOut !== "0xWETH") {
      const pool1 = this.findPoolForPair(tokenIn, "0xWETH");
      const pool2 = this.findPoolForPair("0xWETH", tokenOut);

      if (pool1 && pool2) {
        return [
          {
            protocol: "uniswap-v4",
            poolId: pool1.poolId,
            tokenIn,
            tokenOut: "0xWETH",
            fee: pool1.poolKey.fee,
            liquidity: pool1.liquidity,
            priceImpact: 0.1,
          },
          {
            protocol: "uniswap-v4",
            poolId: pool2.poolId,
            tokenIn: "0xWETH",
            tokenOut,
            fee: pool2.poolKey.fee,
            liquidity: pool2.liquidity,
            priceImpact: 0.1,
          },
        ];
      }
    }

    return [];
  }

  private simulateSwap(route: RouteSegment[], amountIn: bigint): bigint {
    let amount = amountIn;

    for (const segment of route) {
      // Apply fee
      const fee = (amount * BigInt(segment.fee)) / BigInt(1000000);
      amount = amount - fee;

      // Apply price (simplified - uses oracle)
      const priceIn =
        this.priceOracle.get(segment.tokenIn) || BigInt("1000000000000000000");
      const priceOut =
        this.priceOracle.get(segment.tokenOut) || BigInt("1000000000000000000");

      amount = (amount * priceIn) / priceOut;

      // Apply price impact (simplified)
      amount = (amount * BigInt(9990)) / BigInt(10000); // 0.1% impact
    }

    return amount;
  }

  private simulateExactOutputSwap(
    route: RouteSegment[],
    amountOut: bigint,
  ): bigint {
    let amount = amountOut;

    // Reverse through route
    for (let i = route.length - 1; i >= 0; i--) {
      const segment = route[i];

      // Reverse price impact
      amount = (amount * BigInt(10000)) / BigInt(9990);

      // Reverse price
      const priceIn =
        this.priceOracle.get(segment.tokenIn) || BigInt("1000000000000000000");
      const priceOut =
        this.priceOracle.get(segment.tokenOut) || BigInt("1000000000000000000");

      amount = (amount * priceOut) / priceIn;

      // Reverse fee
      amount = (amount * BigInt(1000000)) / BigInt(1000000 - segment.fee);
    }

    return amount;
  }

  private calculateFee(amount: bigint, feeBps: number): bigint {
    return (amount * BigInt(feeBps)) / BigInt(1000000);
  }

  private calculatePriceImpact(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    amountOut: bigint,
  ): number {
    const expectedPrice = this.getCurrentPrice(tokenIn, tokenOut);
    if (expectedPrice === BigInt(0)) return 0;

    const actualPrice = (amountOut * BigInt("1000000000000000000")) / amountIn;
    const impact =
      (Number(expectedPrice - actualPrice) / Number(expectedPrice)) * 100;

    return Math.abs(impact);
  }

  private calculateLiquidityFromAmounts(
    pool: PoolState,
    tickLower: number,
    tickUpper: number,
    amount0: bigint,
    amount1: bigint,
  ): bigint {
    // Simplified liquidity calculation
    return (amount0 + amount1) / BigInt(2);
  }

  private calculateTokensFromLiquidity(
    pool: PoolState,
    tickLower: number,
    tickUpper: number,
    liquidity: bigint,
  ): { amount0: bigint; amount1: bigint } {
    // Simplified token calculation
    return {
      amount0: liquidity / BigInt(2),
      amount1: liquidity / BigInt(2),
    };
  }
}

// ============================================================================
// RESULT TYPES
// ============================================================================

export interface IntentSubmissionResult {
  success: boolean;
  intentId?: string;
  estimatedExecution?: number;
  error?: string;
}

export interface IntentExecutionResult {
  success: boolean;
  amountIn?: bigint;
  amountOut?: bigint;
  amount0?: bigint;
  amount1?: bigint;
  fees0?: bigint;
  fees1?: bigint;
  positionId?: string;
  liquidity?: bigint;
  amount0Used?: bigint;
  amount1Used?: bigint;
  route?: RouteSegment[];
  gasSaved?: bigint;
  pending?: boolean;
  message?: string;
  error?: string;
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const intentEngine = new IntentEngine();
