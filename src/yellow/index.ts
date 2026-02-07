/**
 * Yellow Network Module
 *
 * This module provides real Yellow Network / Nitrolite state channel integration.
 * It replaces the simulated browser-session-engine with actual blockchain interactions.
 *
 * @example
 * ```typescript
 * import {
 *   YellowSessionEngine,
 *   createTestnetEngine,
 *   Channel,
 *   SignedState,
 * } from './yellow';
 *
 * // Create engine for Sepolia testnet
 * const engine = createTestnetEngine(
 *   '0x...' as `0x${string}`, // private key
 *   '0x...' // custodian contract address
 * );
 *
 * // Open a channel
 * const channel = await engine.openChannel({
 *   counterparty: '0x...',
 *   deposit: BigInt(1000000000), // 1000 USDC (6 decimals)
 *   token: '0x...', // USDC address
 * });
 *
 * // Propose and sign state update
 * const state = await engine.proposeState({
 *   channelId: channel.id,
 *   balances: { user: BigInt(900000000), counterparty: BigInt(100000000) },
 * });
 * const signedState = await engine.signState(state);
 * const finalState = await engine.waitForCounterpartySignature(signedState);
 *
 * // Settle channel
 * const receipt = await engine.settle(channel.id, finalState);
 * ```
 */

// Main engine
export { YellowSessionEngine } from "./yellow-session-engine";

// Factory functions
export {
  createTestnetEngine,
  createMainnetEngine,
  createArbitrumEngine,
} from "./yellow-session-engine";

// Types
export type {
  // Channel types
  Channel,
  ChannelState,
  SignedState,

  // Operation parameters
  OpenChannelParams,
  ProposeStateParams,
  SettleParams,
  ChallengeParams,

  // Events
  ChannelOpenedEvent,
  ChannelSettledEvent,
  ChallengeFiledEvent,

  // Configuration
  NitroliteConfig,
  WalletConfig,

  // Utility types
  TokenInfo,
  ChannelBalances,
  ChannelTransactionReceipt,
} from "./types";

// Error types
export { ChannelError, ChannelException } from "./types";

// ============================================================================
// DEPLOYED CONTRACT CONFIGURATION (Sepolia Testnet)
// ============================================================================

/** Deployed YellowSessionCustodian contract address on Sepolia */
export const SEPOLIA_CUSTODIAN_ADDRESS =
  "0x187EDBb934591DF0f078076214e0564DB1c883A4";

/** Sepolia USDC token address (Circle testnet USDC) */
export const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

/** Sepolia WETH token address */
export const SEPOLIA_WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";

import { YellowSessionEngine } from "./yellow-session-engine";
import type { NitroliteConfig } from "./types";

/**
 * Create a pre-configured Yellow Session Engine for Sepolia testnet
 * using the deployed YellowSessionCustodian contract
 *
 * @param privateKey - Wallet private key (hex string starting with 0x)
 * @param customRpcUrl - Optional custom RPC URL (defaults to Alchemy)
 * @returns Configured YellowSessionEngine instance
 */
export function createSepoliaEngine(
  privateKey: `0x${string}`,
  customRpcUrl?: string,
): YellowSessionEngine {
  const config: NitroliteConfig = {
    rpcUrl:
      customRpcUrl ||
      "https://eth-sepolia.g.alchemy.com/v2/Qi9YQb2VqoyJJDPq23fDedrn9v96qf70",
    nodeUrl: "wss://testnet.yellow.org/ws",
    custodianAddress: SEPOLIA_CUSTODIAN_ADDRESS,
    chainId: 11155111,
  };

  return new YellowSessionEngine(config, privateKey);
}
