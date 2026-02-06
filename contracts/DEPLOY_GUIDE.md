und# Deploying YellowSessionCustodian to Sepolia Testnet

## Prerequisites

### 1. Install Foundry

```bash
# On Windows (using WSL or Git Bash)
curl -L https://foundry.paradigm.xyz | bash

# Restart your terminal, then run:
foundryup
```

### 2. Get Sepolia ETH

You need testnet ETH for gas fees. Get some from:

- https://sepoliafaucet.com/
- https://faucet.sepolia.dev/
- https://www.alchemy.com/faucets/ethereum-sepolia

### 3. Get RPC URL

Get a free RPC URL from:

- **Alchemy**: https://www.alchemy.com/ (recommended)
- **Infura**: https://www.infura.io/
- **QuickNode**: https://www.quicknode.com/

---

## Setup

### 1. Navigate to contracts directory

```bash
cd contracts
```

### 2. Initialize Foundry and install dependencies

```bash
# Initialize Foundry project
forge init --no-git --force

# Install OpenZeppelin contracts
forge install OpenZeppelin/openzeppelin-contracts --no-git

# Install forge-std (for scripts)
forge install foundry-rs/forge-std --no-git
```

### 3. Configure environment

Create a `.env` file in the `contracts` directory:

```bash
# contracts/.env
PRIVATE_KEY=your_wallet_private_key_without_0x_prefix
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
ETHERSCAN_API_KEY=your_etherscan_api_key_for_verification
```

> ⚠️ **NEVER commit your private key to git!**

---

## Deploy

### Option A: Using Forge Script (Recommended)

```bash
# Load environment variables
source .env

# Deploy to Sepolia
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url $SEPOLIA_RPC_URL \
  --broadcast \
  --verify \
  -vvvv
```

### Option B: Using Forge Create (Simple)

```bash
# Load environment variables
source .env

# Deploy directly
forge create YellowSessionCustodian \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $PRIVATE_KEY \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

---

## Verify Contract (if not auto-verified)

```bash
forge verify-contract \
  --chain sepolia \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  <DEPLOYED_CONTRACT_ADDRESS> \
  YellowSessionCustodian
```

---

## Update Your .env

After deployment, update the root `.env` file with your contract address:

```env
# Root .env
VITE_CUSTODIAN_ADDRESS=0x_your_deployed_contract_address
VITE_SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
PRIVATE_KEY=0x_your_private_key
```

---

## Test the Deployment

Once deployed, you can verify it works by checking the contract on Etherscan:

- https://sepolia.etherscan.io/address/YOUR_CONTRACT_ADDRESS

---

## Quick Commands Reference

```bash
# Check Foundry installation
forge --version

# Compile contracts
forge build

# Run tests
forge test

# Deploy to Sepolia
forge script script/Deploy.s.sol:DeployScript --rpc-url $SEPOLIA_RPC_URL --broadcast

# Get gas estimate
forge script script/Deploy.s.sol:DeployScript --rpc-url $SEPOLIA_RPC_URL
```

---

## Troubleshooting

### "Insufficient funds"

- Get more Sepolia ETH from a faucet

### "Nonce too low"

- Wait for pending transactions to complete
- Or use `--legacy` flag

### "Cannot find forge-std"

```bash
forge install foundry-rs/forge-std --no-git
```

### "Cannot find openzeppelin"

```bash
forge install OpenZeppelin/openzeppelin-contracts --no-git
```

---

## Estimated Gas Costs

| Action       | Gas Used   | Cost (at 10 gwei) |
| ------------ | ---------- | ----------------- |
| Deploy       | ~1,500,000 | ~0.015 ETH        |
| Open Channel | ~150,000   | ~0.0015 ETH       |
| Settle       | ~100,000   | ~0.001 ETH        |
| Challenge    | ~120,000   | ~0.0012 ETH       |
