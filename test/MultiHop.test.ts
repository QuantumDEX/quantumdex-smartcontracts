import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("Multi-hop Swaps", function () {
  const FEE_BPS = 30; // 0.30%

  async function deployContractsFixture() {
    const signers = await ethers.getSigners();
    const [deployer, alice] = signers;

    // Deploy AMM
    const AMMFactory = await ethers.getContractFactory("AMM", deployer);
    const amm = await AMMFactory.deploy(FEE_BPS);
    await amm.waitForDeployment();
    const ammAddress = await amm.getAddress();

    // Deploy Mock Tokens
    const MockTokenFactory = await ethers.getContractFactory(
      "MockToken",
      deployer
    );
    const tokenA = await MockTokenFactory.deploy("TokenA", "TKA", 18);
    await tokenA.waitForDeployment();
    const tokenAAddress = await tokenA.getAddress();

    const tokenB = await MockTokenFactory.deploy("TokenB", "TKB", 18);
    await tokenB.waitForDeployment();
    const tokenBAddress = await tokenB.getAddress();

    const tokenC = await MockTokenFactory.deploy("TokenC", "TKC", 18);
    await tokenC.waitForDeployment();
    const tokenCAddress = await tokenC.getAddress();

    return {
      amm,
      tokenA,
      tokenB,
      tokenC,
      deployer,
      alice,
      ammAddress,
      tokenAAddress,
      tokenBAddress,
      tokenCAddress,
    };
  }

  describe("Path Validation", function () {
    it("Should reject path with less than 2 tokens", async function () {
      const { amm, alice } = await loadFixture(deployContractsFixture);
      const path = [ethers.ZeroAddress];
      const poolIds: string[] = [];

      await expect(
        amm.swapMultiHop(
          path,
          poolIds,
          ethers.parseUnits("100", 18),
          0,
          alice.address
        )
      ).to.be.revertedWithCustomError(amm, "InvalidPath");
    });

    it("Should reject mismatched poolIds length", async function () {
      const { amm, alice } = await loadFixture(deployContractsFixture);
      const path = [ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress];
      const poolIds: string[] = [];

      await expect(
        amm.swapMultiHop(
          path,
          poolIds,
          ethers.parseUnits("100", 18),
          0,
          alice.address
        )
      ).to.be.revertedWithCustomError(amm, "InvalidPathLength");
    });

    it("Should reject zero input amount", async function () {
      const { amm, tokenA, tokenB, alice } = await loadFixture(
        deployContractsFixture
      );
      const poolId = await amm.getPoolId(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        FEE_BPS
      );
      const path = [await tokenA.getAddress(), await tokenB.getAddress()];
      const poolIds = [poolId];

      await expect(
        amm.swapMultiHop(path, poolIds, 0, 0, alice.address)
      ).to.be.revertedWithCustomError(amm, "ZeroInput");
    });

    it("Should reject zero recipient", async function () {
      const { amm, tokenA, tokenB } = await loadFixture(deployContractsFixture);
      const poolId = await amm.getPoolId(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        FEE_BPS
      );
      const path = [await tokenA.getAddress(), await tokenB.getAddress()];
      const poolIds = [poolId];

      await expect(
        amm.swapMultiHop(
          path,
          poolIds,
          ethers.parseUnits("100", 18),
          0,
          ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(amm, "ZeroRecipient");
    });
  });

  describe("2-Hop Swap", function () {
    it("Should execute 2-hop swap A -> B -> C", async function () {
      const { amm, tokenA, tokenB, tokenC, deployer, alice } =
        await loadFixture(deployContractsFixture);

      // Setup: Create pools A-B and B-C
      const amountA = ethers.parseUnits("10000", 18);
      const amountB = ethers.parseUnits("20000", 18);
      const amountC = ethers.parseUnits("30000", 18);

      await tokenA.mint(deployer.address, amountA * 2n);
      await tokenB.mint(deployer.address, amountB * 3n);
      await tokenC.mint(deployer.address, amountC * 2n);

      await tokenA.approve(await amm.getAddress(), amountA * 2n);
      await tokenB.approve(await amm.getAddress(), amountB * 3n);
      await tokenC.approve(await amm.getAddress(), amountC * 2n);

      // Create pool A-B
      const poolIdAB = await amm.getPoolId(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        FEE_BPS
      );
      await amm.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        0
      );

      // Create pool B-C
      const poolIdBC = await amm.getPoolId(
        await tokenB.getAddress(),
        await tokenC.getAddress(),
        FEE_BPS
      );
      await amm.createPool(
        await tokenB.getAddress(),
        await tokenC.getAddress(),
        amountB,
        amountC,
        0
      );

      // Prepare swap
      const swapAmount = ethers.parseUnits("100", 18);
      await tokenA.mint(alice.address, swapAmount);
      await tokenA.connect(alice).approve(await amm.getAddress(), swapAmount);

      // Build path: [tokenA, poolIdAB, tokenB, poolIdBC, tokenC]
      const path = [
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        await tokenC.getAddress(),
      ];
      const poolIds = [poolIdAB, poolIdBC];

      const initialBalanceC = await tokenC.balanceOf(alice.address);

      // Execute multi-hop swap
      const tx = await amm
        .connect(alice)
        .swapMultiHop(path, poolIds, swapAmount, 0, alice.address);
      await tx.wait();

      const finalBalanceC = await tokenC.balanceOf(alice.address);
      expect(finalBalanceC).to.be.greaterThan(initialBalanceC);
    });

    it("Should handle slippage protection in 2-hop swap", async function () {
      const { amm, tokenA, tokenB, tokenC, deployer, alice } =
        await loadFixture(deployContractsFixture);

      // Setup pools
      const amountA = ethers.parseUnits("10000", 18);
      const amountB = ethers.parseUnits("20000", 18);
      const amountC = ethers.parseUnits("30000", 18);

      await tokenA.mint(deployer.address, amountA * 2n);
      await tokenB.mint(deployer.address, amountB * 3n);
      await tokenC.mint(deployer.address, amountC * 2n);

      await tokenA.approve(await amm.getAddress(), amountA * 2n);
      await tokenB.approve(await amm.getAddress(), amountB * 3n);
      await tokenC.approve(await amm.getAddress(), amountC * 2n);

      const poolIdAB = await amm.getPoolId(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        FEE_BPS
      );
      await amm.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        0
      );

      const poolIdBC = await amm.getPoolId(
        await tokenB.getAddress(),
        await tokenC.getAddress(),
        FEE_BPS
      );
      await amm.createPool(
        await tokenB.getAddress(),
        await tokenC.getAddress(),
        amountB,
        amountC,
        0
      );

      const swapAmount = ethers.parseUnits("100", 18);
      await tokenA.mint(alice.address, swapAmount);
      await tokenA.connect(alice).approve(await amm.getAddress(), swapAmount);

      const path = [
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        await tokenC.getAddress(),
      ];
      const poolIds = [poolIdAB, poolIdBC];

      // Set unrealistic minAmountOut (should fail)
      const unrealisticMin = ethers.parseUnits("1000000", 18);

      await expect(
        amm
          .connect(alice)
          .swapMultiHop(
            path,
            poolIds,
            swapAmount,
            unrealisticMin,
            alice.address
          )
      ).to.be.revertedWithCustomError(amm, "SlippageExceeded");
    });
  });

  describe("Invalid Pool Tests", function () {
    it("Should reject swap with non-existent pool", async function () {
      const { amm, tokenA, tokenB, alice } = await loadFixture(
        deployContractsFixture
      );
      const fakePoolId = ethers.keccak256(ethers.toUtf8Bytes("fake"));
      const path = [await tokenA.getAddress(), await tokenB.getAddress()];
      const poolIds = [fakePoolId];

      await tokenA.mint(alice.address, ethers.parseUnits("100", 18));
      await tokenA
        .connect(alice)
        .approve(await amm.getAddress(), ethers.parseUnits("100", 18));

      await expect(
        amm
          .connect(alice)
          .swapMultiHop(
            path,
            poolIds,
            ethers.parseUnits("100", 18),
            0,
            alice.address
          )
      ).to.be.revertedWithCustomError(amm, "InvalidPool");
    });

    it("Should reject swap with invalid token path", async function () {
      const { amm, tokenA, tokenB, tokenC, deployer, alice } =
        await loadFixture(deployContractsFixture);

      // Create pool A-B
      const amountA = ethers.parseUnits("10000", 18);
      const amountB = ethers.parseUnits("20000", 18);
      await tokenA.mint(deployer.address, amountA);
      await tokenB.mint(deployer.address, amountB);
      await tokenA.approve(await amm.getAddress(), amountA);
      await tokenB.approve(await amm.getAddress(), amountB);

      const poolIdAB = await amm.getPoolId(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        FEE_BPS
      );
      await amm.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        0
      );

      // Try to swap A -> B -> C but pool B-C doesn't exist
      const fakePoolIdBC = ethers.keccak256(ethers.toUtf8Bytes("fake"));
      const path = [
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        await tokenC.getAddress(),
      ];
      const poolIds = [poolIdAB, fakePoolIdBC];

      await tokenA.mint(alice.address, ethers.parseUnits("100", 18));
      await tokenA
        .connect(alice)
        .approve(await amm.getAddress(), ethers.parseUnits("100", 18));

      await expect(
        amm
          .connect(alice)
          .swapMultiHop(
            path,
            poolIds,
            ethers.parseUnits("100", 18),
            0,
            alice.address
          )
      ).to.be.revertedWithCustomError(amm, "InvalidPool");
    });
  });

  describe("Event Emissions", function () {
    it("Should emit Swap events for each hop", async function () {
      const { amm, tokenA, tokenB, tokenC, deployer, alice } =
        await loadFixture(deployContractsFixture);

      // Setup pools
      const amountA = ethers.parseUnits("10000", 18);
      const amountB = ethers.parseUnits("20000", 18);
      const amountC = ethers.parseUnits("30000", 18);

      await tokenA.mint(deployer.address, amountA * 2n);
      await tokenB.mint(deployer.address, amountB * 3n);
      await tokenC.mint(deployer.address, amountC * 2n);

      await tokenA.approve(await amm.getAddress(), amountA * 2n);
      await tokenB.approve(await amm.getAddress(), amountB * 3n);
      await tokenC.approve(await amm.getAddress(), amountC * 2n);

      const poolIdAB = await amm.getPoolId(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        FEE_BPS
      );
      await amm.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        0
      );

      const poolIdBC = await amm.getPoolId(
        await tokenB.getAddress(),
        await tokenC.getAddress(),
        FEE_BPS
      );
      await amm.createPool(
        await tokenB.getAddress(),
        await tokenC.getAddress(),
        amountB,
        amountC,
        0
      );

      const swapAmount = ethers.parseUnits("100", 18);
      await tokenA.mint(alice.address, swapAmount);
      await tokenA.connect(alice).approve(await amm.getAddress(), swapAmount);

      const path = [
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        await tokenC.getAddress(),
      ];
      const poolIds = [poolIdAB, poolIdBC];

      const tx = await amm
        .connect(alice)
        .swapMultiHop(path, poolIds, swapAmount, 0, alice.address);
      const receipt = await tx.wait();

      // Check that Swap events were emitted (one per hop)
      const swapEvents = receipt.logs
        .map((log) => {
          try {
            return amm.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .filter((parsed) => parsed && parsed.name === "Swap");

      expect(swapEvents.length).to.equal(poolIds.length);
    });

    it("Should emit MultiHopSwap event", async function () {
      const { amm, tokenA, tokenB, tokenC, deployer, alice } =
        await loadFixture(deployContractsFixture);

      // Setup pools
      const amountA = ethers.parseUnits("10000", 18);
      const amountB = ethers.parseUnits("20000", 18);
      const amountC = ethers.parseUnits("30000", 18);

      await tokenA.mint(deployer.address, amountA * 2n);
      await tokenB.mint(deployer.address, amountB * 3n);
      await tokenC.mint(deployer.address, amountC * 2n);

      await tokenA.approve(await amm.getAddress(), amountA * 2n);
      await tokenB.approve(await amm.getAddress(), amountB * 3n);
      await tokenC.approve(await amm.getAddress(), amountC * 2n);

      const poolIdAB = await amm.getPoolId(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        FEE_BPS
      );
      await amm.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        0
      );

      const poolIdBC = await amm.getPoolId(
        await tokenB.getAddress(),
        await tokenC.getAddress(),
        FEE_BPS
      );
      await amm.createPool(
        await tokenB.getAddress(),
        await tokenC.getAddress(),
        amountB,
        amountC,
        0
      );

      const swapAmount = ethers.parseUnits("100", 18);
      await tokenA.mint(alice.address, swapAmount);
      await tokenA.connect(alice).approve(await amm.getAddress(), swapAmount);

      const path = [
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        await tokenC.getAddress(),
      ];
      const poolIds = [poolIdAB, poolIdBC];

      await expect(
        amm
          .connect(alice)
          .swapMultiHop(path, poolIds, swapAmount, 0, alice.address)
      ).to.emit(amm, "MultiHopSwap");
    });
  });

  describe("3-Hop Swap", function () {
    it("Should execute 3-hop swap A -> B -> C -> D", async function () {
      const { amm, tokenA, tokenB, tokenC, deployer, alice } =
        await loadFixture(deployContractsFixture);

      // Deploy tokenD
      const MockTokenFactory = await ethers.getContractFactory(
        "MockToken",
        deployer
      );
      const tokenD = await MockTokenFactory.deploy("TokenD", "TKD", 18);
      await tokenD.waitForDeployment();

      // Setup: Create pools A-B, B-C, C-D
      const amountA = ethers.parseUnits("10000", 18);
      const amountB = ethers.parseUnits("20000", 18);
      const amountC = ethers.parseUnits("30000", 18);
      const amountD = ethers.parseUnits("40000", 18);

      await tokenA.mint(deployer.address, amountA * 2n);
      await tokenB.mint(deployer.address, amountB * 4n);
      await tokenC.mint(deployer.address, amountC * 3n);
      await tokenD.mint(deployer.address, amountD * 2n);

      await tokenA.approve(await amm.getAddress(), amountA * 2n);
      await tokenB.approve(await amm.getAddress(), amountB * 4n);
      await tokenC.approve(await amm.getAddress(), amountC * 3n);
      await tokenD.approve(await amm.getAddress(), amountD * 2n);

      // Create pools
      const poolIdAB = await amm.getPoolId(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        FEE_BPS
      );
      await amm.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        0
      );

      const poolIdBC = await amm.getPoolId(
        await tokenB.getAddress(),
        await tokenC.getAddress(),
        FEE_BPS
      );
      await amm.createPool(
        await tokenB.getAddress(),
        await tokenC.getAddress(),
        amountB,
        amountC,
        0
      );

      const poolIdCD = await amm.getPoolId(
        await tokenC.getAddress(),
        await tokenD.getAddress(),
        FEE_BPS
      );
      await amm.createPool(
        await tokenC.getAddress(),
        await tokenD.getAddress(),
        amountC,
        amountD,
        0
      );

      // Prepare swap
      const swapAmount = ethers.parseUnits("100", 18);
      await tokenA.mint(alice.address, swapAmount);
      await tokenA.connect(alice).approve(await amm.getAddress(), swapAmount);

      // Build path: [tokenA, poolIdAB, tokenB, poolIdBC, tokenC, poolIdCD, tokenD]
      const path = [
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        await tokenC.getAddress(),
        await tokenD.getAddress(),
      ];
      const poolIds = [poolIdAB, poolIdBC, poolIdCD];

      const initialBalanceD = await tokenD.balanceOf(alice.address);

      // Execute multi-hop swap
      const tx = await amm
        .connect(alice)
        .swapMultiHop(path, poolIds, swapAmount, 0, alice.address);
      await tx.wait();

      const finalBalanceD = await tokenD.balanceOf(alice.address);
      expect(finalBalanceD).to.be.greaterThan(initialBalanceD);
    });
  });

  describe("Gas Optimization", function () {
    it("Should efficiently handle multiple hops", async function () {
      const { amm, tokenA, tokenB, tokenC, deployer, alice } =
        await loadFixture(deployContractsFixture);

      // Setup pools
      const amountA = ethers.parseUnits("10000", 18);
      const amountB = ethers.parseUnits("20000", 18);
      const amountC = ethers.parseUnits("30000", 18);

      await tokenA.mint(deployer.address, amountA * 2n);
      await tokenB.mint(deployer.address, amountB * 3n);
      await tokenC.mint(deployer.address, amountC * 2n);

      await tokenA.approve(await amm.getAddress(), amountA * 2n);
      await tokenB.approve(await amm.getAddress(), amountB * 3n);
      await tokenC.approve(await amm.getAddress(), amountC * 2n);

      const poolIdAB = await amm.getPoolId(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        FEE_BPS
      );
      await amm.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        0
      );

      const poolIdBC = await amm.getPoolId(
        await tokenB.getAddress(),
        await tokenC.getAddress(),
        FEE_BPS
      );
      await amm.createPool(
        await tokenB.getAddress(),
        await tokenC.getAddress(),
        amountB,
        amountC,
        0
      );

      const swapAmount = ethers.parseUnits("100", 18);
      await tokenA.mint(alice.address, swapAmount);
      await tokenA.connect(alice).approve(await amm.getAddress(), swapAmount);

      const path = [
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        await tokenC.getAddress(),
      ];
      const poolIds = [poolIdAB, poolIdBC];

      // Execute swap and verify it completes
      const tx = await amm
        .connect(alice)
        .swapMultiHop(path, poolIds, swapAmount, 0, alice.address);
      const receipt = await tx.wait();
      expect(receipt.status).to.equal(1);
    });
  });

  describe("Maximum Hops Limit", function () {
    it("Should reject path with too many hops", async function () {
      const { amm, tokenA, tokenB, alice } = await loadFixture(
        deployContractsFixture
      );

      // Create a route with more than 10 hops (token path length = hops + 1)
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      const fakePoolId = ethers.keccak256(ethers.toUtf8Bytes("fake"));

      // Build a token path with 11 hops => 12 tokens
      const path: string[] = [tokenAAddr];
      for (let i = 0; i < 11; i++) {
        path.push(i % 2 === 0 ? tokenBAddr : tokenAAddr);
      }
      const poolIds: string[] = Array.from({ length: 11 }, () => fakePoolId);

      await tokenA.mint(alice.address, ethers.parseUnits("100", 18));
      await tokenA
        .connect(alice)
        .approve(await amm.getAddress(), ethers.parseUnits("100", 18));

      await expect(
        amm
          .connect(alice)
          .swapMultiHop(
            path,
            poolIds,
            ethers.parseUnits("100", 18),
            0,
            alice.address
          )
      ).to.be.revertedWithCustomError(amm, "InvalidPathLength");
    });
  });
});
