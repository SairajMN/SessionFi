/**
 * SessionFi Hook Client
 *
 * TypeScript client for interacting with the SessionFiHook Solidity contract.
 */

import { ethers } from "ethers";

// ============================================================================
// CONTRACT ABI
// ============================================================================

const SESSIONFI_HOOK_ABI = [
  // Session Management
  "function createSession(uint256 duration) external returns (bytes32 sessionId)",
  "function depositToSession(bytes32 sessionId, address token, uint256 amount) external",
  "function settleSession(bytes32 sessionId, bytes32 finalStateHash) external",
  "function withdrawFromSession(bytes32 sessionId, address token) external",
  "function forceCloseSession(bytes32 sessionId) external",

  // Swap Execution
  "function executeSwapIntent((bytes32 sessionId, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint256 deadline, bytes signature) intent) external",

  // View Functions
  "function getSession(bytes32 sessionId) external view returns (address owner, bytes32 stateHash, uint256 nonce, uint256 lockedAmount, uint256 availableAmount, uint256 totalVolume, uint256 createdAt, uint256 expiresAt, bool isActive)",
  "function getSessionBalance(bytes32 sessionId, address token) external view returns (uint256)",
  "function getUserSessions(address user) external view returns (bytes32[])",
  "function calculateFee(uint256 totalVolume, uint256 amount) external pure returns (uint256)",

  // Constants
  "function BASE_FEE() external view returns (uint256)",
  "function HIGH_VOLUME_FEE() external view returns (uint256)",
  "function HIGH_VOLUME_THRESHOLD() external view returns (uint256)",

  // Events
  "event SessionCreated(bytes32 indexed sessionId, address indexed owner, uint256 lockedAmount, uint256 expiresAt)",
  "event SessionDeposit(bytes32 indexed sessionId, address indexed token, uint256 amount)",
  "event SwapExecutedInSession(bytes32 indexed sessionId, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 fee)",
  "event SessionSettled(bytes32 indexed sessionId, bytes32 finalStateHash, uint256 totalVolume)",
  "event IntentExecuted(bytes32 indexed sessionId, bytes32 indexed intentHash, bool success)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

// ============================================================================
// TYPES
// ============================================================================

export interface SessionDetails {
  sessionId: string;
  owner: string;
  stateHash: string;
  nonce: number;
  lockedAmount: string;
  availableAmount: string;
  totalVolume: string;
  createdAt: number;
  expiresAt: number;
  isActive: boolean;
}

export interface SwapIntent {
  sessionId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  minAmountOut: bigint;
  deadline: number;
  signature?: string;
}

interface CreateSessionResult {
  sessionId: string;
  txHash: string;
  expiresAt: number;
}

interface DepositResult {
  txHash: string;
  amount: string;
  token: string;
}

interface SwapResult {
  success: boolean;
  txHash: string;
  amountIn: string;
  amountOut: string;
  fee: string;
}

// ============================================================================
// SESSIONFI HOOK CLIENT
// ============================================================================

/**
 * SessionFiHookClient - Interact with the SessionFiHook contract
 */
export class SessionFiHookClient {
  private contract: ethers.Contract;
  private signer: ethers.Signer;
  private provider: ethers.Provider;

  constructor(
    hookAddress: string,
    signerOrProvider: ethers.Signer | ethers.Provider,
  ) {
    if ("getAddress" in signerOrProvider) {
      this.signer = signerOrProvider as ethers.Signer;
      this.provider = this.signer.provider!;
      this.contract = new ethers.Contract(
        hookAddress,
        SESSIONFI_HOOK_ABI,
        this.signer,
      );
    } else {
      this.provider = signerOrProvider as ethers.Provider;
      this.signer = null as any;
      this.contract = new ethers.Contract(
        hookAddress,
        SESSIONFI_HOOK_ABI,
        this.provider,
      );
    }
  }

  // ==========================================================================
  // SESSION MANAGEMENT
  // ==========================================================================

  /**
   * Create a new trading session
   */
  async createSession(durationSeconds: number): Promise<CreateSessionResult> {
    console.log(`[Hook] Creating session with duration ${durationSeconds}s...`);

    const tx = await this.contract.createSession(durationSeconds);
    const receipt = await tx.wait();

    // Find SessionCreated event
    const event = receipt.logs.find(
      (log: any) => log.fragment?.name === "SessionCreated",
    );

    const sessionId = event?.args?.sessionId;
    const expiresAt = Number(event?.args?.expiresAt);

    console.log(`[Hook] Session created: ${sessionId}`);

    return {
      sessionId,
      txHash: receipt.hash,
      expiresAt,
    };
  }

  /**
   * Deposit tokens into a session
   */
  async depositToSession(
    sessionId: string,
    tokenAddress: string,
    amount: bigint,
  ): Promise<DepositResult> {
    console.log(`[Hook] Depositing ${amount} to session ${sessionId}...`);

    // Approve token first
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.signer);
    const approveTx = await token.approve(
      await this.contract.getAddress(),
      amount,
    );
    await approveTx.wait();
    console.log(`[Hook] Token approved`);

    // Deposit
    const tx = await this.contract.depositToSession(
      sessionId,
      tokenAddress,
      amount,
    );
    const receipt = await tx.wait();

    console.log(`[Hook] Deposit complete: ${receipt.hash}`);

    return {
      txHash: receipt.hash,
      amount: amount.toString(),
      token: tokenAddress,
    };
  }

  /**
   * Execute a swap intent within a session
   */
  async executeSwapIntent(intent: SwapIntent): Promise<SwapResult> {
    console.log(
      `[Hook] Executing swap intent in session ${intent.sessionId}...`,
    );

    // Sign the intent if not already signed
    const signature = intent.signature || (await this.signIntent(intent));

    const intentTuple = {
      sessionId: intent.sessionId,
      tokenIn: intent.tokenIn,
      tokenOut: intent.tokenOut,
      amountIn: intent.amountIn,
      minAmountOut: intent.minAmountOut,
      deadline: intent.deadline,
      signature,
    };

    const tx = await this.contract.executeSwapIntent(intentTuple);
    const receipt = await tx.wait();

    // Find SwapExecutedInSession event
    const event = receipt.logs.find(
      (log: any) => log.fragment?.name === "SwapExecutedInSession",
    );

    const amountIn = event?.args?.amountIn?.toString() || "0";
    const amountOut = event?.args?.amountOut?.toString() || "0";
    const fee = event?.args?.fee?.toString() || "0";

    console.log(
      `[Hook] Swap executed: ${amountIn} -> ${amountOut} (fee: ${fee})`,
    );

    return {
      success: true,
      txHash: receipt.hash,
      amountIn,
      amountOut,
      fee,
    };
  }

  /**
   * Settle and close a session
   */
  async settleSession(sessionId: string): Promise<{ txHash: string }> {
    console.log(`[Hook] Settling session ${sessionId}...`);

    // Get current state hash
    const session = await this.getSession(sessionId);

    const tx = await this.contract.settleSession(sessionId, session.stateHash);
    const receipt = await tx.wait();

    console.log(`[Hook] Session settled: ${receipt.hash}`);

    return { txHash: receipt.hash };
  }

  /**
   * Withdraw tokens after session settlement
   */
  async withdrawFromSession(
    sessionId: string,
    tokenAddress: string,
  ): Promise<{ txHash: string; amount: string }> {
    console.log(`[Hook] Withdrawing from session ${sessionId}...`);

    // Get balance before
    const balance = await this.getSessionBalance(sessionId, tokenAddress);

    const tx = await this.contract.withdrawFromSession(sessionId, tokenAddress);
    const receipt = await tx.wait();

    console.log(`[Hook] Withdrawal complete: ${receipt.hash}`);

    return {
      txHash: receipt.hash,
      amount: balance,
    };
  }

  /**
   * Force close an expired session
   */
  async forceCloseSession(sessionId: string): Promise<{ txHash: string }> {
    console.log(`[Hook] Force closing session ${sessionId}...`);

    const tx = await this.contract.forceCloseSession(sessionId);
    const receipt = await tx.wait();

    console.log(`[Hook] Session force closed: ${receipt.hash}`);

    return { txHash: receipt.hash };
  }

  // ==========================================================================
  // VIEW FUNCTIONS
  // ==========================================================================

  /**
   * Get session details
   */
  async getSession(sessionId: string): Promise<SessionDetails> {
    const result = await this.contract.getSession(sessionId);

    return {
      sessionId,
      owner: result.owner,
      stateHash: result.stateHash,
      nonce: Number(result.nonce),
      lockedAmount: result.lockedAmount.toString(),
      availableAmount: result.availableAmount.toString(),
      totalVolume: result.totalVolume.toString(),
      createdAt: Number(result.createdAt),
      expiresAt: Number(result.expiresAt),
      isActive: result.isActive,
    };
  }

  /**
   * Get session token balance
   */
  async getSessionBalance(sessionId: string, token: string): Promise<string> {
    const balance = await this.contract.getSessionBalance(sessionId, token);
    return balance.toString();
  }

  /**
   * Get all sessions for a user
   */
  async getUserSessions(userAddress: string): Promise<string[]> {
    return this.contract.getUserSessions(userAddress);
  }

  /**
   * Calculate fee for a swap
   */
  async calculateFee(totalVolume: bigint, amount: bigint): Promise<string> {
    const fee = await this.contract.calculateFee(totalVolume, amount);
    return fee.toString();
  }

  /**
   * Get fee constants
   */
  async getFeeConstants(): Promise<{
    baseFee: number;
    highVolumeFee: number;
    highVolumeThreshold: string;
  }> {
    const [baseFee, highVolumeFee, threshold] = await Promise.all([
      this.contract.BASE_FEE(),
      this.contract.HIGH_VOLUME_FEE(),
      this.contract.HIGH_VOLUME_THRESHOLD(),
    ]);

    return {
      baseFee: Number(baseFee),
      highVolumeFee: Number(highVolumeFee),
      highVolumeThreshold: threshold.toString(),
    };
  }

  // ==========================================================================
  // HELPER FUNCTIONS
  // ==========================================================================

  /**
   * Sign a swap intent
   */
  async signIntent(intent: SwapIntent): Promise<string> {
    const intentHash = ethers.keccak256(
      ethers.solidityPacked(
        ["bytes32", "address", "address", "uint256", "uint256", "uint256"],
        [
          intent.sessionId,
          intent.tokenIn,
          intent.tokenOut,
          intent.amountIn,
          intent.minAmountOut,
          intent.deadline,
        ],
      ),
    );

    return this.signer.signMessage(ethers.getBytes(intentHash));
  }

  /**
   * Create and sign an intent
   */
  createIntent(
    sessionId: string,
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    minAmountOut: bigint,
    deadlineSeconds: number = 3600,
  ): SwapIntent {
    return {
      sessionId,
      tokenIn,
      tokenOut,
      amountIn,
      minAmountOut,
      deadline: Math.floor(Date.now() / 1000) + deadlineSeconds,
    };
  }

  /**
   * Get contract address
   */
  getAddress(): Promise<string> {
    return this.contract.getAddress();
  }

  /**
   * Check if session is still active and not expired
   */
  async isSessionValid(sessionId: string): Promise<boolean> {
    const session = await this.getSession(sessionId);
    const now = Math.floor(Date.now() / 1000);
    return session.isActive && session.expiresAt > now;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a SessionFiHookClient from RPC URL and private key
 */
export function createSessionFiHookClient(
  hookAddress: string,
  rpcUrl: string,
  privateKey: string,
): SessionFiHookClient {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);
  return new SessionFiHookClient(hookAddress, signer);
}
