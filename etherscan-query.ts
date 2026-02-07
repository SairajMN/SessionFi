import fetch from "node-fetch";
import { config } from "dotenv";
config();

// Etherscan API configuration
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;
const ETHERSCAN_API_URL = "https://api.etherscan.io/api";

// Contract addresses to query
const CONTRACT_ADDRESSES = {
  yellowCustodian: "0x187EDBb934591DF0f078076214e0564DB1c883A4",
  sessionFiHook: "0x73c44610f97f2560cD27c53370987B827DB30beA",
};

// Function to query contract information from Etherscan
async function queryContract(address: string, contractName: string) {
  try {
    const abiResponse = await fetch(
      `${ETHERSCAN_API_URL}?module=contract&action=getabi&address=${address}&apikey=${ETHERSCAN_API_KEY}`,
    );
    const abiData = await abiResponse.json();

    console.log(`\n=== ${contractName} (${address}) ===`);

    if (abiData.status === "1" && abiData.result) {
      console.log("Contract found!");
      console.log("ABI available:", abiData.result.length > 0);
      console.log(
        "Contract creation code:",
        abiData.result.includes("constructor") ? "Yes" : "No",
      );
    } else {
      console.log(
        "Error:",
        abiData.result || "Contract not found or no ABI available",
      );
    }

    // Get contract code
    const sourceResponse = await fetch(
      `${ETHERSCAN_API_URL}?module=contract&action=getsourcecode&address=${address}&apikey=${ETHERSCAN_API_KEY}`,
    );
    const sourceData = await sourceResponse.json();

    if (sourceData.status === "1" && sourceData.result[0]) {
      const contractInfo = sourceData.result[0];
      console.log("\nContract Details:");
      console.log("Contract Name:", contractInfo.ContractName);
      console.log("Compiler:", contractInfo.Compiler);
      console.log("Optimization Used:", contractInfo.OptimizationUsed);
      console.log("Runs:", contractInfo.Runs);
      console.log("Constructor Arguments:", contractInfo.ConstructorArguments);
      console.log("Balance:", contractInfo.Balance);
      console.log("Status:", contractInfo.Status);
      console.log("Txn Count:", contractInfo.TxnCount);
    }
  } catch (error) {
    console.error(`Error querying ${contractName}:`, error);
  }
}

// Main function to query all contracts
async function main() {
  if (!ETHERSCAN_API_KEY) {
    console.error(
      "Please set your ETHERSCAN_API_KEY in the environment variables",
    );
    return;
  }

  console.log("Querying contracts on Etherscan...\n");

  await queryContract(CONTRACT_ADDRESSES.yellowCustodian, "Yellow Custodian");
  await queryContract(CONTRACT_ADDRESSES.sessionFiHook, "SessionFi Hook");

  console.log("\n=== Query Complete ===");
}

// Run the main function
main().catch(console.error);
