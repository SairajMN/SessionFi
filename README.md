# SessionFi + Uniswap v4 + Sui: Intent-Based AMM Sessions

> Gasless DeFi Sessions with Programmable Hooks and High-Performance Settlement

## 🎯 Core Innovation

Combines **SessionFi's intent-based settlement** with **Uniswap v4's hook system** to create programmable, gasless AMM interactions.

```
User Intent → SessionFi (Yellow) → Uniswap v4 Hooks → Sui Settlement
```

## ⚡ MVP Features

### 1. Intent-Based Swaps

Define swap outcomes, not steps. Users specify WHAT they want, not HOW to achieve it.

```typescript
// Traditional: Multiple steps, multiple transactions
// Intent-Based: Single intent, gasless execution
const intent = engine.createExactInputSwapIntent(
  session,
  tokenIn,
  tokenOut,
  amountIn,
  minAmountOut,
  { maxSlippageBps: 50 },
);
```

### 2. Programmable Hooks

Custom Uniswap v4 hooks for session-based AMM interactions:

- `beforeSwap` - Validate swap against session intent
- `afterSwap` - Update session state and metrics
- `beforeAddLiquidity` - Validate LP operations
- `afterRemoveLiquidity` - Return tokens to session

### 3. Gasless Liquidity Provision

Add/remove liquidity without paying gas - all operations batched into session:

```typescript
// Add liquidity - GASLESS
const addIntent = engine.createAddLiquidityIntent(
  session, poolId, token0Amount, token1Amount,
  tickLower, tickUpper, minLiquidity
);

// Remove liquidity - GASLESS
const removeIntent = engine.createRemoveLiquidityIntent(
  session, positionId, liquidityToRemove,
  minToken0, minToken1, collectFees: true
);
```

### 4. Cross-DEX Routing

Intent-based routing across multiple AMMs via LI.FI integration:

```typescript
const route = await lifiRouter.getBestRoute(
  {
    fromChainId: 1,
    toChainId: 42161,
    fromToken: "USDC",
    toToken: "WETH",
    fromAmount: BigInt(1000000000),
    slippage: 0.5,
  },
  { priority: "CHEAPEST" },
);
```

## 🏗️ Technical Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER INTERFACE                           │
│                   (Intent Creation & Display)                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      INTENT ENGINE                              │
│    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│    │ Swap Intents │  │  LP Intents  │  │Cross-Chain   │         │
│    │              │  │              │  │   Intents    │         │
│    └──────────────┘  └──────────────┘  └──────────────┘         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    UNISWAP V4 HOOKS                             │
│    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│    │ beforeSwap   │  │ afterSwap    │  │ beforeLiq    │         │
│    │ (validate)   │  │ (update)     │  │ (validate)   │         │
│    └──────────────┘  └──────────────┘  └──────────────┘         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LIFI ROUTER                                  │
│         (Cross-chain & Cross-DEX Routing)                       │
│    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│    │  Stargate    │  │   Across     │  │     Hop      │         │
│    └──────────────┘  └──────────────┘  └──────────────┘         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SUI SETTLEMENT                               │
│    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│    │ Token Settle │  │ Position NFT │  │  Proof       │         │
│    │              │  │   Minting    │  │  Verify      │         │
│    └──────────────┘  └──────────────┘  └──────────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
src/
├── amm/                          # AMM Sessions Module
│   ├── types.ts                  # Core AMM types & interfaces
│   ├── index.ts                  # Public exports
│   ├── engine/
│   │   └── intent-engine.ts      # Intent processing & execution
│   ├── hooks/
│   │   └── uniswap-v4-hooks.ts   # Uniswap v4 hook system
│   ├── routing/
│   │   └── lifi-router.ts        # LI.FI cross-chain routing
│   └── settlement/
│       └── sui-settlement.ts     # Sui settlement layer
├── core/
│   └── types.ts                  # Base SessionFi types
├── crypto/
│   └── browser-primitives.ts     # Cryptographic functions
├── engine/
│   └── browser-session-engine.ts # Base session engine
├── settlement/
│   └── browser-verifier.ts       # Settlement verification
├── AMMApp.tsx                    # AMM Demo UI
├── App.tsx                       # Original SessionFi demo
└── main.tsx                      # Application entry
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/SairajMN/SessionFi.git
cd SessionFi

# Install dependencies
npm install

# Start development server
npm run dev
```

### Running the Demo

```bash
npm run dev
```

Then open http://localhost:5173 in your browser.

## 🎮 Demo Walkthrough

1. **Create Session** - Lock tokens (USDC, WETH, USDT) into an AMM session
2. **Execute Swaps** - Perform gasless intent-based swaps
3. **Add Liquidity** - Provide liquidity without gas fees
4. **Batch Operations** - Execute multiple swaps instantly
5. **Settle on Sui** - Finalize all operations with one transaction

## 🌟 Why It's Novel

- **First intent-based AMM system** - Users define outcomes, not execution paths
- **Eliminates gas for liquidity operations** - All LP actions are gasless
- **Enables complex AMM strategies** - Without per-transaction overhead
- **Creates new primitive: "AMM session"** - A new DeFi building block

## 🔧 Key Types

### AMMSession

```typescript
interface AMMSession {
  sessionId: string;
  ownerAddress: string;
  status: AMMSessionStatus;
  lockedTokens: Map<string, bigint>;
  availableTokens: Map<string, bigint>;
  activeIntents: AMMIntent[];
  completedIntents: AMMIntent[];
  liquidityPositions: LiquidityPosition[];
  totalSwapVolume: bigint;
  totalGasSaved: bigint;
  nonce: number;
  stateHash: string;
}
```

### Intent Types

```typescript
enum IntentType {
  EXACT_INPUT_SWAP,
  EXACT_OUTPUT_SWAP,
  LIMIT_ORDER,
  TWAP_ORDER,
  ADD_LIQUIDITY,
  REMOVE_LIQUIDITY,
  MULTI_HOP_SWAP,
  CROSS_DEX_SWAP,
}
```

## 📊 Gas Savings Comparison

| Operation          | Traditional   | SessionFi    | Savings |
| ------------------ | ------------- | ------------ | ------- |
| Single Swap        | 150,000 gas   | 0 gas        | 100%    |
| 10 Swaps           | 1,500,000 gas | 0 gas        | 100%    |
| Add Liquidity      | 200,000 gas   | 0 gas        | 100%    |
| Remove Liquidity   | 200,000 gas   | 0 gas        | 100%    |
| Session Settlement | N/A           | ~100,000 gas | N/A     |

**Total for 10 swaps + LP operations:**

- Traditional: 1,900,000 gas
- SessionFi: 100,000 gas
- **Savings: 94.7%**

## 🛠️ API Reference

### IntentEngine

```typescript
// Create session
const session = intentEngine.createSession(
  ownerAddress,
  ownerEns,
  lockedTokens,
  expiresAt,
);

// Create swap intent
const intent = intentEngine.createExactInputSwapIntent(
  session,
  tokenIn,
  tokenOut,
  amountIn,
  minAmountOut,
  constraints,
);

// Submit intent
const result = intentEngine.submitIntent(session, intent, signature);

// Execute intent
const execution = await intentEngine.executeIntent(session, intent);

// Get quote
const quote = intentEngine.getQuote(quoteRequest);
```

### SuiSettlementEngine

```typescript
// Generate settlement proof
const proof = suiSettlementEngine.generateSettlementProof(
  session,
  userPrivateKey,
  enginePrivateKey,
);

// Settle session
const result = await suiSettlementEngine.settleSession(
  session,
  proof,
  userSignature,
  engineSignature,
);
```

### LiFiRouter

```typescript
// Get routes
const routes = await lifiRouter.getRoutes(quoteRequest, preferences);

// Get best route
const bestRoute = await lifiRouter.getBestRoute(quoteRequest);

// Execute cross-chain swap
const result = await lifiRouter.executeCrossChainSwap(session, intent, route);
```

## 📜 License

MIT License - see [LICENSE](LICENSE) for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

**Built for ETHGlobal Bangkok 2024**

SessionFi + Uniswap v4 + Sui = Intent-Based AMM Sessions 🚀
