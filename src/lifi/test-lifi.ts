/**
 * LI.FI Integration Test
 *
 * Tests the real LI.FI SDK integration for cross-chain routing.
 * Run with: npx tsx src/lifi/test-lifi.ts
 */

import { realLiFiRouter } from "./real-lifi-router";
import { lifiSessionIntegration } from "./lifi-session-integration";
import { LiFiChainId } from "./types";

// Token addresses (mainnet)
const TOKENS = {
  // Ethereum Mainnet
  ETH_USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  ETH_WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  ETH_USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",

  // Arbitrum
  ARB_USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  ARB_WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",

  // Polygon
  POLY_USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  POLY_WMATIC: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",

  // Base
  BASE_USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  BASE_WETH: "0x4200000000000000000000000000000000000006",
};

async function testGetSupportedChains() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST: Get Supported Chains");
  console.log("=".repeat(60));

  try {
    const chains = await realLiFiRouter.getSupportedChains();
    console.log(`✅ Found ${chains.length} supported chains`);

    // Show first 10 chains
    console.log("\nSample chains:");
    for (const chain of chains.slice(0, 10)) {
      console.log(`  - ${chain.name} (ID: ${chain.id})`);
    }
  } catch (error) {
    console.error("❌ Failed:", error);
  }
}

async function testGetTokensForChain() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST: Get Tokens for Ethereum");
  console.log("=".repeat(60));

  try {
    const tokens = await realLiFiRouter.getTokensForChain(LiFiChainId.ETHEREUM);
    console.log(`✅ Found ${tokens.length} tokens on Ethereum`);

    // Show first 10 tokens
    console.log("\nSample tokens:");
    for (const token of tokens.slice(0, 10)) {
      console.log(`  - ${token.symbol}: ${token.address}`);
    }
  } catch (error) {
    console.error("❌ Failed:", error);
  }
}

async function testGetRoutesSameChain() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST: Get Routes (Same Chain - Ethereum)");
  console.log("=".repeat(60));

  try {
    const result = await realLiFiRouter.getRoutes({
      fromChainId: LiFiChainId.ETHEREUM,
      toChainId: LiFiChainId.ETHEREUM,
      fromTokenAddress: TOKENS.ETH_USDC,
      toTokenAddress: TOKENS.ETH_WETH,
      fromAmount: "1000000000", // 1000 USDC (6 decimals)
      fromAddress: "0x0000000000000000000000000000000000000001",
    });

    if (result.success) {
      console.log(`✅ Found ${result.routes.length} routes`);

      if (result.bestRoute) {
        console.log("\nBest Route:");
        console.log(
          `  From: ${result.bestRoute.fromToken.symbol} on chain ${result.bestRoute.fromChainId}`,
        );
        console.log(
          `  To: ${result.bestRoute.toToken.symbol} on chain ${result.bestRoute.toChainId}`,
        );
        console.log(`  Input: ${result.bestRoute.fromAmount}`);
        console.log(`  Output: ${result.bestRoute.toAmount}`);
        console.log(`  Min Output: ${result.bestRoute.toAmountMin}`);
        console.log(`  Gas Cost: $${result.bestRoute.gasCostUSD}`);
        console.log(`  Steps: ${result.bestRoute.steps.length}`);

        for (const step of result.bestRoute.steps) {
          console.log(
            `    - ${step.type}: ${step.tool} (${step.estimate.executionDuration}s)`,
          );
        }
      }
    } else {
      console.log(`❌ No routes found: ${result.error}`);
    }
  } catch (error) {
    console.error("❌ Failed:", error);
  }
}

async function testGetRoutesCrossChain() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST: Get Routes (Cross-Chain - Ethereum to Arbitrum)");
  console.log("=".repeat(60));

  try {
    const result = await realLiFiRouter.getRoutes({
      fromChainId: LiFiChainId.ETHEREUM,
      toChainId: LiFiChainId.ARBITRUM,
      fromTokenAddress: TOKENS.ETH_USDC,
      toTokenAddress: TOKENS.ARB_USDC,
      fromAmount: "1000000000", // 1000 USDC
      fromAddress: "0x0000000000000000000000000000000000000001",
      options: {
        slippage: 0.005,
        order: "CHEAPEST",
      },
    });

    if (result.success) {
      console.log(`✅ Found ${result.routes.length} cross-chain routes`);

      if (result.bestRoute) {
        console.log("\nBest Route:");
        console.log(`  From: ${result.bestRoute.fromToken.symbol} on Ethereum`);
        console.log(`  To: ${result.bestRoute.toToken.symbol} on Arbitrum`);
        console.log(`  Input: ${result.bestRoute.fromAmount}`);
        console.log(`  Output: ${result.bestRoute.toAmount}`);
        console.log(`  Gas Cost: $${result.bestRoute.gasCostUSD}`);
        console.log(`  Duration: ${result.estimatedDuration}s`);

        console.log("\n  Steps:");
        for (const step of result.bestRoute.steps) {
          console.log(`    ${step.type}: ${step.tool}`);
          console.log(
            `      ${step.action.fromToken.symbol} -> ${step.action.toToken.symbol}`,
          );
          console.log(`      Duration: ${step.estimate.executionDuration}s`);
        }

        // Calculate costs
        const costs = realLiFiRouter.calculateTotalCost(result.bestRoute);
        console.log("\n  Costs:");
        console.log(`    Gas: $${costs.gasCostUSD}`);
        console.log(`    Bridge Fee: $${costs.bridgeFeeUSD}`);
        console.log(`    Total: $${costs.totalUSD}`);
      }
    } else {
      console.log(`❌ No routes found: ${result.error}`);
    }
  } catch (error) {
    console.error("❌ Failed:", error);
  }
}

async function testSessionIntegration() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST: Session Integration");
  console.log("=".repeat(60));

  try {
    const sessionId = "test-session-" + Date.now();

    // Get a quote
    const quoteResult = await lifiSessionIntegration.getSwapQuote({
      sessionId,
      fromChainId: LiFiChainId.ETHEREUM,
      toChainId: LiFiChainId.ARBITRUM,
      fromToken: TOKENS.ETH_USDC,
      toToken: TOKENS.ARB_USDC,
      fromAmount: "500000000", // 500 USDC
      slippage: 0.005,
      orderPreference: "RECOMMENDED",
    });

    if (quoteResult.success) {
      console.log("✅ Got session swap quote");
      console.log(`  Routes available: ${quoteResult.routes.length}`);
      console.log(`  Best output: ${quoteResult.estimatedOutput}`);
      console.log(`  Gas cost: $${quoteResult.gasCostUSD}`);
    } else {
      console.log(`❌ Quote failed: ${quoteResult.error}`);
    }

    // Execute swap (will just track it, not actually execute)
    const swapResult = await lifiSessionIntegration.executeSessionSwap(
      {
        sessionId,
        fromChainId: LiFiChainId.ETHEREUM,
        toChainId: LiFiChainId.ARBITRUM,
        fromToken: TOKENS.ETH_USDC,
        toToken: TOKENS.ARB_USDC,
        fromAmount: "500000000",
        slippage: 0.005,
      },
      "0x0000000000000000000000000000000000000001",
    );

    if (swapResult.success) {
      console.log("\n✅ Session swap initiated");
      console.log(`  Swap ID: ${swapResult.swapId}`);
      console.log(`  Estimated output: ${swapResult.estimatedOutput}`);
      console.log(`  Estimated duration: ${swapResult.estimatedDuration}s`);

      // Check session metrics
      const metrics = lifiSessionIntegration.getSessionMetrics(sessionId);
      console.log("\n  Session Metrics:");
      console.log(`    Total swaps: ${metrics.totalSwaps}`);
      console.log(`    Pending: ${metrics.pendingSwaps}`);
      console.log(`    Completed: ${metrics.completedSwaps}`);
    } else {
      console.log(`❌ Swap failed: ${swapResult.error}`);
    }
  } catch (error) {
    console.error("❌ Failed:", error);
  }
}

async function testChainConnections() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST: Chain Connections");
  console.log("=".repeat(60));

  try {
    const connections = await realLiFiRouter.getChainConnections(
      LiFiChainId.ETHEREUM,
      LiFiChainId.ARBITRUM,
    );

    console.log(`✅ Ethereum -> Arbitrum connections`);
    console.log(`  From tokens: ${connections.fromTokens.length}`);
    console.log(`  To tokens: ${connections.toTokens.length}`);

    if (connections.fromTokens.length > 0) {
      console.log("\n  Sample from tokens:");
      for (const token of connections.fromTokens.slice(0, 5)) {
        console.log(`    - ${token.symbol}`);
      }
    }
  } catch (error) {
    console.error("❌ Failed:", error);
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log(
    "╔══════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║           LI.FI Integration Test Suite                       ║",
  );
  console.log(
    "║           SessionFi Protocol - Phase 2                       ║",
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝",
  );

  try {
    // Run tests
    await testGetSupportedChains();
    await testGetTokensForChain();
    await testGetRoutesSameChain();
    await testGetRoutesCrossChain();
    await testSessionIntegration();
    await testChainConnections();

    console.log("\n" + "=".repeat(60));
    console.log("All tests completed!");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\n❌ Test suite failed:", error);
    process.exit(1);
  }
}

main().catch(console.error);
