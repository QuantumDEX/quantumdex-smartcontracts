import { network } from "hardhat";

// Network configuration mapping
const NETWORK_CONFIG: Record<string, { name: string; chainType: "l1" | "op" }> = {
  base: { name: "base", chainType: "l1" },
  baseSepolia: { name: "baseSepolia", chainType: "l1" },
  celo: { name: "celo", chainType: "l1" },
  celoAlfajores: { name: "celoAlfajores", chainType: "l1" },
  sepolia: { name: "sepolia", chainType: "l1" },
  hardhatMainnet: { name: "hardhatMainnet", chainType: "l1" },
  hardhatOp: { name: "hardhatOp", chainType: "op" },
};

async function main() {
  // Get network name from command line argument or use default
  const networkName = process.argv[2] || "hardhatMainnet";
  
  if (!NETWORK_CONFIG[networkName]) {
    console.error(`Unknown network: ${networkName}`);
    console.error(`Available networks: ${Object.keys(NETWORK_CONFIG).join(", ")}`);
    process.exit(1);
  }

  const networkConfig = NETWORK_CONFIG[networkName];
  console.log(`\n🚀 Deploying to ${networkName}...\n`);

  const { viem } = await network.connect({
    network: networkConfig.name,
    chainType: networkConfig.chainType,
  });

  const publicClient = await viem.getPublicClient();
  const [walletClient] = await viem.getWalletClients();

  const deployer = walletClient.account.address;
  const chainId = Number(await publicClient.getChainId());
  
  console.log("Network:", networkName);
  console.log("Chain ID:", chainId);
  console.log("Deployer address:", deployer);
  console.log("Deploying AMM contract...\n");

  // Default fee in basis points (e.g., 30 = 0.30%)
  // You can modify this value or make it configurable via environment variables
  const defaultFeeBps = 30; // 0.30%

  // Deploy contract
  const deployment = await viem.deployContract("AMM", [defaultFeeBps]);
  const ammAddress = deployment.address;
  console.log("✅ AMM deployed to:", ammAddress);
  
  // Get transaction hash from deployment if available
  const txHash = (deployment as any).hash || (deployment as any).transactionHash || "N/A";
  if (txHash !== "N/A") {
    console.log("Transaction hash:", txHash);
    // Wait for deployment transaction to be confirmed
    console.log("Waiting for confirmation...");
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log("✅ Transaction confirmed!\n");
  } else {
    console.log("✅ Deployment completed!\n");
  }

  // Instantiate contract instance bound to clients
  const amm = await viem.getContractAt("AMM", ammAddress, {
    client: { public: publicClient, wallet: walletClient },
  });

  // Verify deployment by reading the default fee
  const fee = await amm.read.defaultFeeBps();
  
  console.log("📋 Deployment Summary:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Network:", networkName);
  console.log("Chain ID:", chainId);
  console.log("AMM Contract Address:", ammAddress);
  console.log("Deployer:", deployer);
  console.log("Default Fee:", fee.toString(), "basis points (" + Number(fee) / 100 + "%)");
  if (txHash !== "N/A") {
    console.log("Transaction Hash:", txHash);
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

