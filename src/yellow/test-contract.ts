/**
 * Test script to interact with deployed YellowSessionCustodian contract
 * Run: npx tsx src/yellow/test-contract.ts
 */

import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

// Deployed contract address on Sepolia
const CUSTODIAN_ADDRESS = "0x187EDBb934591DF0f078076214e0564DB1c883A4";

// ABI for the YellowSessionCustodian contract
const CUSTODIAN_ABI = [
  "function openChannel(address counterparty, address token, uint256 deposit, uint256 challengePeriod) external returns (bytes32 channelId)",
  "function depositCounterparty(bytes32 channelId, uint256 amount) external",
  "function settle(bytes32 channelId, uint256 userFinal, uint256 counterpartyFinal, uint256 nonce, bytes memory userSig, bytes memory counterpartySig) external",
  "function challenge(bytes32 channelId, uint256 userBalance, uint256 counterpartyBalance, uint256 nonce, bytes memory userSig, bytes memory counterpartySig) external",
  "function respondToChallenge(bytes32 channelId, uint256 userBalance, uint256 counterpartyBalance, uint256 nonce, bytes memory userSig, bytes memory counterpartySig) external",
  "function forceClose(bytes32 channelId) external",
  "function getChannel(bytes32 channelId) external view returns (address user, address counterparty, address token, uint256 userDeposit, uint256 counterpartyDeposit, uint256 nonce, uint256 challengePeriod, uint256 challengeExpiry, bool isOpen, bool challenged)",
  "function getPendingSettlement(bytes32 channelId) external view returns (uint256 userBalance, uint256 counterpartyBalance, uint256 nonce, uint256 expiresAt)",
  "function isChannelOpen(bytes32 channelId) external view returns (bool)",
  "function getTotalDeposits(bytes32 channelId) external view returns (uint256)",
  "function MIN_CHALLENGE_PERIOD() external view returns (uint256)",
  "function MAX_CHALLENGE_PERIOD() external view returns (uint256)",
  "function DEFAULT_CHALLENGE_PERIOD() external view returns (uint256)",
  "event ChannelOpened(bytes32 indexed channelId, address indexed user, address indexed counterparty, address token, uint256 deposit, uint256 challengePeriod)",
  "event CounterpartyDeposited(bytes32 indexed channelId, uint256 amount)",
  "event ChannelSettled(bytes32 indexed channelId, uint256 userFinal, uint256 counterpartyFinal, uint256 nonce)",
  "event ChallengeFiled(bytes32 indexed channelId, address indexed challenger, uint256 nonce, uint256 expiresAt)",
  "event ChallengeResponded(bytes32 indexed channelId, uint256 newNonce)",
  "event ChannelForceClosed(bytes32 indexed channelId, uint256 userFinal, uint256 counterpartyFinal)",
];

// ERC20 ABI for token approval
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
];

// Sepolia testnet tokens
const SEPOLIA_TOKENS = {
  // WETH on Sepolia
  WETH: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
  // USDC on Sepolia (Circle's testnet USDC)
  USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  // DAI on Sepolia
  DAI: "0x68194a729C2450ad26072b3D33ADaCbcef39D574",
};

async function main() {
  console.log("🧪 Testing YellowSessionCustodian Contract\n");
  console.log("Contract Address:", CUSTODIAN_ADDRESS);
  console.log("Network: Sepolia Testnet\n");

  // Setup provider and signer
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

  console.log("Wallet Address:", wallet.address);

  // Check balance
  const balance = await provider.getBalance(wallet.address);
  console.log("ETH Balance:", ethers.formatEther(balance), "ETH\n");

  // Connect to custodian contract
  const custodian = new ethers.Contract(
    CUSTODIAN_ADDRESS,
    CUSTODIAN_ABI,
    wallet,
  );

  // Read contract constants
  console.log("📋 Contract Constants:");
  const minChallengePeriod = await custodian.MIN_CHALLENGE_PERIOD();
  const maxChallengePeriod = await custodian.MAX_CHALLENGE_PERIOD();
  const defaultChallengePeriod = await custodian.DEFAULT_CHALLENGE_PERIOD();

  console.log(
    "  MIN_CHALLENGE_PERIOD:",
    minChallengePeriod.toString(),
    "seconds (",
    Number(minChallengePeriod) / 3600,
    "hours)",
  );
  console.log(
    "  MAX_CHALLENGE_PERIOD:",
    maxChallengePeriod.toString(),
    "seconds (",
    Number(maxChallengePeriod) / 86400,
    "days)",
  );
  console.log(
    "  DEFAULT_CHALLENGE_PERIOD:",
    defaultChallengePeriod.toString(),
    "seconds (",
    Number(defaultChallengePeriod) / 3600,
    "hours)",
  );

  console.log("\n✅ Contract is responsive and deployed correctly!");
  console.log("\n📝 Next Steps:");
  console.log("  1. Get testnet tokens (WETH, USDC, etc.) from faucets");
  console.log("  2. Approve token spending for the custodian");
  console.log("  3. Open a channel with a counterparty");
  console.log("  4. Test off-chain state updates");
  console.log("  5. Settle the channel");

  console.log("\n🔗 Useful Links:");
  console.log(
    "  Contract on Etherscan: https://sepolia.etherscan.io/address/" +
      CUSTODIAN_ADDRESS,
  );
  console.log("  Sepolia Faucet: https://sepoliafaucet.com/");
  console.log("  Circle USDC Faucet: https://faucet.circle.com/");
}

/**
 * Demo: Open a channel (requires testnet tokens)
 */
async function demoOpenChannel() {
  console.log("\n🚀 Demo: Opening a Channel\n");

  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  const custodian = new ethers.Contract(
    CUSTODIAN_ADDRESS,
    CUSTODIAN_ABI,
    wallet,
  );

  // Use a test token (you need some testnet tokens first)
  const tokenAddress = SEPOLIA_TOKENS.USDC;
  const depositAmount = ethers.parseUnits("10", 6); // 10 USDC (6 decimals)
  const challengePeriod = 3600; // 1 hour (minimum allowed)

  // First approve the custodian to spend tokens
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

  console.log("1. Checking token balance...");
  const tokenBalance = await token.balanceOf(wallet.address);
  console.log("   Token Balance:", ethers.formatUnits(tokenBalance, 6), "USDC");

  if (tokenBalance < depositAmount) {
    console.log("\n⚠️ Insufficient token balance. Get testnet USDC from:");
    console.log("   https://faucet.circle.com/");
    return;
  }

  console.log("\n2. Approving token spending...");
  const approveTx = await token.approve(CUSTODIAN_ADDRESS, depositAmount);
  await approveTx.wait();
  console.log("   Approved!");

  console.log("\n3. Opening channel...");
  // Use a dummy counterparty address for testing
  const counterparty = "0x0000000000000000000000000000000000000001";

  const tx = await custodian.openChannel(
    counterparty,
    tokenAddress,
    depositAmount,
    challengePeriod,
  );

  console.log("   Transaction sent:", tx.hash);

  const receipt = await tx.wait();
  console.log("   Transaction confirmed!");

  // Get channel ID from event
  const channelOpenedEvent = receipt.logs.find(
    (log: any) =>
      log.topics[0] ===
      ethers.id(
        "ChannelOpened(bytes32,address,address,address,uint256,uint256)",
      ),
  );

  if (channelOpenedEvent) {
    const channelId = channelOpenedEvent.topics[1];
    console.log("\n✅ Channel Opened!");
    console.log("   Channel ID:", channelId);

    // Read channel details
    const channel = await custodian.getChannel(channelId);
    console.log("\n📊 Channel Details:");
    console.log("   User:", channel.user);
    console.log("   Counterparty:", channel.counterparty);
    console.log("   Token:", channel.token);
    console.log(
      "   User Deposit:",
      ethers.formatUnits(channel.userDeposit, 6),
      "USDC",
    );
    console.log("   Is Open:", channel.isOpen);
  }
}

/**
 * Generate state hash for off-chain signatures
 */
function generateStateHash(
  channelId: string,
  userBalance: bigint,
  counterpartyBalance: bigint,
  nonce: bigint,
  isFinal: boolean = false,
): string {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["bytes32", "uint256", "uint256", "uint256", "bool"],
      [channelId, userBalance, counterpartyBalance, nonce, isFinal],
    ),
  );
}

/**
 * Sign a state hash
 */
async function signState(
  wallet: ethers.Wallet,
  stateHash: string,
): Promise<string> {
  const messageHash = ethers.hashMessage(ethers.getBytes(stateHash));
  return wallet.signMessage(ethers.getBytes(stateHash));
}

// Run main test
main().catch(console.error);

// Export for use in other scripts
export {
  CUSTODIAN_ADDRESS,
  CUSTODIAN_ABI,
  ERC20_ABI,
  SEPOLIA_TOKENS,
  generateStateHash,
  signState,
  demoOpenChannel,
};
