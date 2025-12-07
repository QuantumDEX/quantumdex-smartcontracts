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
});

