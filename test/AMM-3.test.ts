import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

describe("AMM Tests (Part 3) - Issue #13: Events Indexing Optimization", function () {
  const FEE_BPS = 30; // 0.30%

  async function deployContractsFixture() {
    const [deployer, alice, bob] = await ethers.getSigners();

    const AMMFactory = await ethers.getContractFactory("AMM", deployer);
    const amm = (await AMMFactory.deploy(FEE_BPS)) as any;
    await amm.waitForDeployment();
    const ammAddress = await amm.getAddress();

    const MockTokenFactory = await ethers.getContractFactory(
      "MockToken",
      deployer
    );

    const tokenA = (await MockTokenFactory.deploy("TokenA", "TKA", 18)) as any;
    await tokenA.waitForDeployment();
    const tokenAAddress = await tokenA.getAddress();

    const tokenB = (await MockTokenFactory.deploy("TokenB", "TKB", 18)) as any;
    await tokenB.waitForDeployment();
    const tokenBAddress = await tokenB.getAddress();

    return {
      amm,
      tokenA,
      tokenB,
      deployer,
      alice,
      bob,
      ammAddress,
      tokenAAddress,
      tokenBAddress,
    };
  }

  async function setupPoolFixture() {
    const base = await deployContractsFixture();
    const {
      amm,
      tokenA,
      tokenB,
      deployer,
      ammAddress,
      tokenAAddress,
      tokenBAddress,
    } = base;

    const amountA = ethers.parseUnits("1000", 18);
    const amountB = ethers.parseUnits("2000", 18);

    // Ensure deployer has balances (MockToken typically mints initial supply to deployer,
    // but we also mint to be explicit and robust).
    await tokenA.mint(deployer.address, amountA);
    await tokenB.mint(deployer.address, amountB);

    await tokenA.approve(ammAddress, amountA);
    await tokenB.approve(ammAddress, amountB);

    const poolId = await amm.getPoolId(tokenAAddress, tokenBAddress, FEE_BPS);

    const tx = await amm.createPool(
      tokenAAddress,
      tokenBAddress,
      amountA,
      amountB,
      0
    );
    await tx.wait();

    return {
      ...base,
      poolId,
      amountA,
      amountB,
    };
  }

  function sortTokens(a: string, b: string) {
    return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  }

  describe("PoolUpdated event emission", function () {
    it("Should emit PoolUpdated when creating a pool", async function () {
      const { amm, tokenA, tokenB, deployer, ammAddress } = await loadFixture(
        deployContractsFixture
      );

      const tokenAAddress = await tokenA.getAddress();
      const tokenBAddress = await tokenB.getAddress();

      const amountA = ethers.parseUnits("1000", 18);
      const amountB = ethers.parseUnits("2000", 18);

      await tokenA.mint(deployer.address, amountA);
      await tokenB.mint(deployer.address, amountB);

      await tokenA.approve(ammAddress, amountA);
      await tokenB.approve(ammAddress, amountB);

      const poolId = await amm.getPoolId(tokenAAddress, tokenBAddress, FEE_BPS);
      const [token0, token1] = sortTokens(tokenAAddress, tokenBAddress);

      // Note: PoolUpdated is emitted during createPool.
      // We only assert indexed fields (poolId/token0/token1) and basic value sanity.
      await expect(
        amm.createPool(tokenAAddress, tokenBAddress, amountA, amountB, 0)
      )
        .to.emit(amm, "PoolUpdated")
        .withArgs(poolId, token0, token1, anyValue, anyValue, anyValue);
    });

    it("Should emit PoolUpdated when adding liquidity", async function () {
      const {
        amm,
        tokenA,
        tokenB,
        deployer,
        ammAddress,
        poolId,
        amountA,
        amountB,
      } = await loadFixture(setupPoolFixture);

      const tokenAAddress = await tokenA.getAddress();
      const tokenBAddress = await tokenB.getAddress();
      const [token0, token1] = sortTokens(tokenAAddress, tokenBAddress);

      // Add liquidity in token0/token1 order
      const isTokenAFirst =
        tokenAAddress.toLowerCase() < tokenBAddress.toLowerCase();
      const amount0Desired = isTokenAFirst ? amountA : amountB;
      const amount1Desired = isTokenAFirst ? amountB : amountA;

      await tokenA.mint(deployer.address, amountA);
      await tokenB.mint(deployer.address, amountB);
      await tokenA.approve(ammAddress, amountA);
      await tokenB.approve(ammAddress, amountB);

      await expect(amm.addLiquidity(poolId, amount0Desired, amount1Desired))
        .to.emit(amm, "PoolUpdated")
        .withArgs(poolId, token0, token1, anyValue, anyValue, anyValue);
    });

    it("Should emit PoolUpdated when removing liquidity", async function () {
      const { amm, tokenA, tokenB, deployer, poolId } = await loadFixture(
        setupPoolFixture
      );

      const tokenAAddress = await tokenA.getAddress();
      const tokenBAddress = await tokenB.getAddress();
      const [token0, token1] = sortTokens(tokenAAddress, tokenBAddress);

      const lpBalance = await amm.getLpBalance(poolId, deployer.address);
      expect(lpBalance).to.be.greaterThan(0);

      // Remove a portion
      const removeAmount = lpBalance / 2n;

      await expect(amm.removeLiquidity(poolId, removeAmount))
        .to.emit(amm, "PoolUpdated")
        .withArgs(poolId, token0, token1, anyValue, anyValue, anyValue);
    });

    it("Should emit PoolUpdated when swapping", async function () {
      const { amm, tokenA, tokenB, deployer, ammAddress, poolId } =
        await loadFixture(setupPoolFixture);

      const tokenAAddress = await tokenA.getAddress();
      const tokenBAddress = await tokenB.getAddress();
      const [token0, token1] = sortTokens(tokenAAddress, tokenBAddress);

      // Swap tokenA -> tokenB
      const swapAmount = ethers.parseUnits("100", 18);

      await tokenA.mint(deployer.address, swapAmount);
      await tokenA.approve(ammAddress, swapAmount);

      // minAmountOut = 0 for event-focused test
      await expect(
        amm.swap(poolId, tokenAAddress, swapAmount, 0, deployer.address)
      )
        .to.emit(amm, "PoolUpdated")
        .withArgs(poolId, token0, token1, anyValue, anyValue, anyValue);
    });
  });
});
