import { expect } from "chai";
import { viem } from "hardhat";
import { getAddress, parseEther, formatEther } from "viem";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";

describe("AMM Tests", function () {
  // Test constants
  const FEE_BPS = 30n; // 0.30%
  const MINIMUM_LIQUIDITY = 1000n;

  async function deployContractsFixture() {
    const [deployer, alice, bob] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();

    // Deploy AMM
    const amm = await viem.deployContract("AMM", [FEE_BPS], {
      client: { wallet: deployer },
    });

    // Deploy Mock Tokens
    const tokenA = await viem.deployContract(
      "MockToken",
      ["TokenA", "TKA", 18],
      { client: { wallet: deployer } }
    );

    const tokenB = await viem.deployContract(
      "MockToken",
      ["TokenB", "TKB", 18],
      { client: { wallet: deployer } }
    );

    return {
      amm,
      tokenA,
      tokenB,
      deployer,
      alice,
      bob,
      publicClient,
    };
  }

  describe("Issue #1: ERC20 Mock Token", function () {
    it("Should deploy MockToken with correct name, symbol, and decimals", async function () {
      const { tokenA } = await loadFixture(deployContractsFixture);
      const publicClient = await viem.getPublicClient();

      const name = await tokenA.read.name();
      const symbol = await tokenA.read.symbol();
      const decimals = await tokenA.read.decimals();

      expect(name).to.equal("TokenA");
      expect(symbol).to.equal("TKA");
      expect(decimals).to.equal(18);
    });

    it("Should mint initial supply to deployer", async function () {
      const { tokenA, deployer } = await loadFixture(deployContractsFixture);
      const publicClient = await viem.getPublicClient();

      const balance = await tokenA.read.balanceOf([deployer.account.address]);
      const expectedBalance = parseEther("1000000"); // 1M tokens

      expect(balance).to.equal(expectedBalance);
    });

    it("Should allow owner to mint tokens", async function () {
      const { tokenA, deployer, alice } = await loadFixture(deployContractsFixture);
      const publicClient = await viem.getPublicClient();

      const mintAmount = parseEther("1000");
      await tokenA.write.mint([alice.account.address, mintAmount], {
        account: deployer.account,
      });

      const balance = await tokenA.read.balanceOf([alice.account.address]);
      expect(balance).to.equal(mintAmount);
    });

    it("Should not allow non-owner to mint tokens", async function () {
      const { tokenA, alice, bob } = await loadFixture(deployContractsFixture);

      const mintAmount = parseEther("1000");
      await expect(
        tokenA.write.mint([bob.account.address, mintAmount], {
          account: alice.account,
        })
      ).to.be.rejected;
    });
  });

  describe("Issue #2: AMM Core Contract", function () {
    it("Should deploy AMM with correct default fee", async function () {
      const { amm } = await loadFixture(deployContractsFixture);

      const defaultFee = await amm.read.defaultFeeBps();
      expect(defaultFee).to.equal(FEE_BPS);
    });

    it("Should create a pool with initial liquidity", async function () {
      const { amm, tokenA, tokenB, deployer } = await loadFixture(deployContractsFixture);
      const publicClient = await viem.getPublicClient();

      const amountA = parseEther("1000");
      const amountB = parseEther("2000");

      // Mint and approve tokens
      await tokenA.write.mint([deployer.account.address, amountA], {
        account: deployer.account,
      });
      await tokenB.write.mint([deployer.account.address, amountB], {
        account: deployer.account,
      });

      await tokenA.write.approve([amm.address, amountA], {
        account: deployer.account,
      });
      await tokenB.write.approve([amm.address, amountB], {
        account: deployer.account,
      });

      // Create pool
      const hash = await amm.write.createPool(
        [tokenA.address, tokenB.address, amountA, amountB, 0],
        { account: deployer.account }
      );
      await publicClient.waitForTransactionReceipt({ hash });

      // Get pool ID
      const poolId = await amm.read.getPoolId([tokenA.address, tokenB.address, FEE_BPS]);

      // Verify pool exists
      const pool = await amm.read.getPool([poolId]);
      expect(pool[0].toLowerCase()).to.equal(
        tokenA.address.toLowerCase() < tokenB.address.toLowerCase()
          ? tokenA.address.toLowerCase()
          : tokenB.address.toLowerCase()
      );
      expect(Number(pool[2])).to.be.greaterThan(0);
      expect(Number(pool[3])).to.be.greaterThan(0);
    });

    it("Should add liquidity to existing pool", async function () {
      const { amm, tokenA, tokenB, deployer } = await loadFixture(deployContractsFixture);
      const publicClient = await viem.getPublicClient();

      const amountA = parseEther("1000");
      const amountB = parseEther("2000");

      // Setup tokens
      await tokenA.write.mint([deployer.account.address, amountA * 2n], {
        account: deployer.account,
      });
      await tokenB.write.mint([deployer.account.address, amountB * 2n], {
        account: deployer.account,
      });

      await tokenA.write.approve([amm.address, amountA * 2n], {
        account: deployer.account,
      });
      await tokenB.write.approve([amm.address, amountB * 2n], {
        account: deployer.account,
      });

      // Create pool
      const poolId = await amm.read.getPoolId([tokenA.address, tokenB.address, FEE_BPS]);
      const hash1 = await amm.write.createPool(
        [tokenA.address, tokenB.address, amountA, amountB, 0],
        { account: deployer.account }
      );
      await publicClient.waitForTransactionReceipt({ hash: hash1 });

      // Add more liquidity
      const hash2 = await amm.write.addLiquidity([poolId, amountA, amountB], {
        account: deployer.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: hash2 });

      // Verify reserves increased
      const pool = await amm.read.getPool([poolId]);
      expect(Number(pool[2])).to.equal(Number(amountA * 2n));
      expect(Number(pool[3])).to.equal(Number(amountB * 2n));
    });

    it("Should remove liquidity from pool", async function () {
      const { amm, tokenA, tokenB, deployer } = await loadFixture(deployContractsFixture);
      const publicClient = await viem.getPublicClient();

      const amountA = parseEther("1000");
      const amountB = parseEther("2000");

      // Setup and create pool
      await tokenA.write.mint([deployer.account.address, amountA], {
        account: deployer.account,
      });
      await tokenB.write.mint([deployer.account.address, amountB], {
        account: deployer.account,
      });

      await tokenA.write.approve([amm.address, amountA], {
        account: deployer.account,
      });
      await tokenB.write.approve([amm.address, amountB], {
        account: deployer.account,
      });

      const poolId = await amm.read.getPoolId([tokenA.address, tokenB.address, FEE_BPS]);
      const hash1 = await amm.write.createPool(
        [tokenA.address, tokenB.address, amountA, amountB, 0],
        { account: deployer.account }
      );
      await publicClient.waitForTransactionReceipt({ hash: hash1 });

      // Get LP balance
      const lpBalance = await amm.read.getLpBalance([poolId, deployer.account.address]);
      expect(Number(lpBalance)).to.be.greaterThan(0);

      // Remove some liquidity
      const removeAmount = lpBalance / 2n;
      const hash2 = await amm.write.removeLiquidity([poolId, removeAmount], {
        account: deployer.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: hash2 });

      // Verify LP balance decreased
      const newLpBalance = await amm.read.getLpBalance([poolId, deployer.account.address]);
      expect(Number(newLpBalance)).to.be.lessThan(Number(lpBalance));
    });

    it("Should execute token swap", async function () {
      const { amm, tokenA, tokenB, deployer } = await loadFixture(deployContractsFixture);
      const publicClient = await viem.getPublicClient();

      const amountA = parseEther("1000");
      const amountB = parseEther("2000");
      const swapAmount = parseEther("100");

      // Setup and create pool
      await tokenA.write.mint([deployer.account.address, amountA + swapAmount], {
        account: deployer.account,
      });
      await tokenB.write.mint([deployer.account.address, amountB], {
        account: deployer.account,
      });

      await tokenA.write.approve([amm.address, amountA + swapAmount], {
        account: deployer.account,
      });
      await tokenB.write.approve([amm.address, amountB], {
        account: deployer.account,
      });

      const poolId = await amm.read.getPoolId([tokenA.address, tokenB.address, FEE_BPS]);
      const hash1 = await amm.write.createPool(
        [tokenA.address, tokenB.address, amountA, amountB, 0],
        { account: deployer.account }
      );
      await publicClient.waitForTransactionReceipt({ hash: hash1 });

      // Get initial balances
      const initialBalanceA = await tokenA.read.balanceOf([deployer.account.address]);
      const initialBalanceB = await tokenB.read.balanceOf([deployer.account.address]);

      // Execute swap
      const hash2 = await amm.write.swap(
        [poolId, tokenA.address, swapAmount, 0n, deployer.account.address],
        { account: deployer.account }
      );
      await publicClient.waitForTransactionReceipt({ hash: hash2 });

      // Verify balances changed
      const finalBalanceA = await tokenA.read.balanceOf([deployer.account.address]);
      const finalBalanceB = await tokenB.read.balanceOf([deployer.account.address]);

      expect(Number(finalBalanceA)).to.be.lessThan(Number(initialBalanceA));
      expect(Number(finalBalanceB)).to.be.greaterThan(Number(initialBalanceB));
    });
  });
});

