/**
 * Yellow Network / Nitrolite Types
 *
 * These types define the data structures for Yellow Network state channel integration.
 * Yellow Network uses the Nitrolite protocol for state channels.
 */

// ============================================================================
// CHANNEL TYPES
// ============================================================================

/**
 * Represents a state channel between two parties.
 */
export interface Channel {
  /** Unique channel identifier */
  id: string;

  /** Address of the user (initiator) */
  user: string;

  /** Address of the counterparty (engine/hub) */
  counterparty: string;

  /** Token address locked in channel */
  token: string;

  /** User's deposit amount */
  userDeposit: bigint;

  /** Counterparty's deposit amount */
  counterpartyDeposit: bigint;

  /** Current nonce (state version) */
  nonce: number;

  /** Challenge period in seconds */
  challengePeriod: number;

  /** Whether channel is open */
  isOpen: boolean;

  /** Timestamp when channel was opened */
  openedAt: number;

  /** Chain ID where channel exists */
  chainId: number;
}

/**
 * Represents a state within a channel.
 */
export interface ChannelState {
  /** Channel ID this state belongs to */
  channelId: string;

  /** State version number */
  nonce: number;

  /** User's current balance */
  userBalance: bigint;

  /** Counterparty's current balance */
  counterpartyBalance: bigint;

  /** Hash of the state data */
  stateHash: string;

  /** Whether state is finalized */
  isFinal: boolean;

  /** Timestamp of state creation */
  timestamp: number;
}

/**
 * Signed state with both party signatures.
 */
export interface SignedState extends ChannelState {
  /** User's signature over stateHash */
  userSignature: string;

  /** Counterparty's signature over stateHash */
  counterpartySignature: string;
}

// ============================================================================
// CHANNEL OPERATIONS
// ============================================================================

/**
 * Parameters for opening a new channel.
 */
export interface OpenChannelParams {
  /** Counterparty address */
  counterparty: string;

  /** Initial deposit amount */
  deposit: bigint;

  /** Token address to deposit */
  token: string;

  /** Challenge period in seconds (default: 86400 = 24 hours) */
  challengePeriod?: number;
}

/**
 * Parameters for proposing a new state.
 */
export interface ProposeStateParams {
  /** Channel ID */
  channelId: string;

  /** New balances */
  balances: {
    user: bigint;
    counterparty: bigint;
  };

  /** Whether this is the final state */
  isFinal?: boolean;
}

/**
 * Parameters for settling a channel.
 */
export interface SettleParams {
  /** Channel ID */
  channelId: string;

  /** Final signed state */
  finalState: SignedState;
}

/**
 * Parameters for challenging a channel.
 */
export interface ChallengeParams {
  /** Channel ID */
  channelId: string;

  /** Latest signed state */
  latestState: SignedState;
}

// ============================================================================
// EVENTS
// ============================================================================

/**
 * Event emitted when a channel is opened.
 */
export interface ChannelOpenedEvent {
  channelId: string;
  user: string;
  counterparty: string;
  token: string;
  userDeposit: bigint;
  timestamp: number;
}

/**
 * Event emitted when a channel is settled.
 */
export interface ChannelSettledEvent {
  channelId: string;
  userFinal: bigint;
  counterpartyFinal: bigint;
  nonce: number;
  timestamp: number;
}

/**
 * Event emitted when a challenge is filed.
 */
export interface ChallengeFiledEvent {
  channelId: string;
  challenger: string;
  nonce: number;
  expiresAt: number;
}

// ============================================================================
// CLIENT CONFIGURATION
// ============================================================================

/**
 * Configuration for the Nitrolite client.
 */
export interface NitroliteConfig {
  /** JSON-RPC provider URL */
  rpcUrl: string;

  /** Yellow Network WebSocket URL */
  nodeUrl: string;

  /** Custodian contract address */
  custodianAddress: string;

  /** Chain ID */
  chainId: number;
}

/**
 * Wallet configuration for signing.
 */
export interface WalletConfig {
  /** Private key (hex string) */
  privateKey: string;

  /** Derived address */
  address: string;
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export enum ChannelError {
  CHANNEL_NOT_FOUND = "CHANNEL_NOT_FOUND",
  CHANNEL_CLOSED = "CHANNEL_CLOSED",
  INVALID_NONCE = "INVALID_NONCE",
  INVALID_SIGNATURE = "INVALID_SIGNATURE",
  INSUFFICIENT_BALANCE = "INSUFFICIENT_BALANCE",
  CHALLENGE_PERIOD_ACTIVE = "CHALLENGE_PERIOD_ACTIVE",
  COUNTERPARTY_UNRESPONSIVE = "COUNTERPARTY_UNRESPONSIVE",
  TIMEOUT = "TIMEOUT",
}

export class ChannelException extends Error {
  constructor(
    public readonly code: ChannelError,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ChannelException";
  }
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Token metadata.
 */
export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  name: string;
}

/**
 * Channel balance summary.
 */
export interface ChannelBalances {
  user: bigint;
  counterparty: bigint;
  total: bigint;
}

/**
 * Transaction receipt from on-chain operations.
 */
export interface ChannelTransactionReceipt {
  transactionHash: string;
  blockNumber: number;
  gasUsed: bigint;
  status: "success" | "failed";
  events: (ChannelOpenedEvent | ChannelSettledEvent | ChallengeFiledEvent)[];
}
