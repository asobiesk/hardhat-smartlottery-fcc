const { assert, expect } = require("chai");
const { network, getNamedAccounts, deployments, ethers } = require("hardhat");
const { developmentChains } = require("../../helper-hardhat-config");

!developmentChains.includes(network.name.toLowerCase())
    ? describe.skip
    : describe("Raffle", () => {
          let deployer, raffle, vrfCoordinatorV2Mock, entranceFee, interval;

          beforeEach(async () => {
              deployer = (await getNamedAccounts()).deployer;
              await deployments.fixture(["all"]);
              raffle = await ethers.getContract("Raffle", deployer);
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer);
              entranceFee = await raffle.getEntranceFee();
              interval = await raffle.getInterval();
          });

          describe("constructor", () => {
              it("initializes the raffle contract correctly", async () => {
                  const raffleState = await raffle.getRaffleState();
                  const interval = await raffle.getInterval();
                  assert.equal(raffleState.toString(), "0");
                  assert.equal(interval.toString(), "30");
              });
          });

          describe("enterRaffle", () => {
              it("reverts if you don't pay enough", async () => {
                  await expect(raffle.enterRaffle()).to.be.revertedWith("Raffle__InsufficientFunds");
              });

              it("records players when they enter", async () => {
                  await raffle.enterRaffle({ value: entranceFee });
                  const playerFromContract = await raffle.getPlayer(0);
                  assert.equal(playerFromContract, deployer);
              });

              it("emits event on enter", async () => {
                  await expect(raffle.enterRaffle({ value: entranceFee })).to.emit(raffle, "RaffleEnter");
              });

              it("doesn't allow entrance when raffle is calcualting", async () => {
                  await raffle.enterRaffle({ value: entranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  await raffle.performUpkeep([]);
                  await expect(raffle.enterRaffle({ value: entranceFee })).to.be.revertedWith("Raffle__NotOpen");
              });
          });

          describe("checkUpkeep", () => {
              it("returns false if people haven't sent any ETH", async () => {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  let upkeepNeeded;
                  [upkeepNeeded] = await raffle.callStatic.checkUpkeep([]);
                  assert(!upkeepNeeded);
              });

              it("returns false if raffle isn't open", async () => {
                  await raffle.enterRaffle({ value: entranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  await raffle.performUpkeep([]);
                  let upkeepNeeded;
                  [upkeepNeeded] = await raffle.callStatic.checkUpkeep([]);
                  assert(!upkeepNeeded);
              });

              it("returns false if enough time hasn't passed", async () => {
                  await raffle.enterRaffle({ value: entranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 10]);
                  await network.provider.send("evm_mine", []);
                  let upkeepNeeded;
                  [upkeepNeeded] = await raffle.callStatic.checkUpkeep([]);
                  assert(!upkeepNeeded);
              });

              it("returns true if enough time has passed, has players, eth, and is open", async () => {
                  await raffle.enterRaffle({ value: entranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  let upkeepNeeded;
                  [upkeepNeeded] = await raffle.callStatic.checkUpkeep([]);
                  assert(upkeepNeeded);
              });
          });

          describe("performUpkeep", () => {
              it("can only run if checkUpkeep is true", async () => {
                  await expect(raffle.performUpkeep([])).to.be.revertedWith("Raffle__UpkeepNotNeeded");
                  await raffle.enterRaffle({ value: entranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  const tx = await raffle.performUpkeep([]);
                  assert(tx);
              });

              it("emits an event", async () => {
                  await raffle.enterRaffle({ value: entranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  const txResponse = await raffle.performUpkeep([]);
                  const txReceipt = await txResponse.wait(1);
                  const requestId = txReceipt.events[1].args.requestId;
                  assert(requestId.toNumber() > 0);
              });

              it("changes the raffleState to CALCULATING", async () => {
                  await raffle.enterRaffle({ value: entranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  await raffle.performUpkeep([]);
                  const raffleState = await raffle.getRaffleState();
                  assert.equal(raffleState.toString(), "1");
              });
          });

          describe("fulfillRandomWords", () => {
              beforeEach(async () => {
                  await raffle.enterRaffle({ value: entranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
              });

              it("can only be called after performUpkeep", async () => {
                  await expect(vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)).to.be.revertedWith(
                      "nonexistent request"
                  );
                  await expect(vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)).to.be.revertedWith(
                      "nonexistent request"
                  );
              });

              it("picks a winner, resets a lottery and sends money", async () => {
                  const additionalEntrants = 3;
                  const startingAccountIndex = 1; //because deployer is 0
                  const accounts = await ethers.getSigners();
                  for (let i = startingAccountIndex; i < startingAccountIndex + additionalEntrants; i++) {
                      const accountConnectedRaffle = raffle.connect(accounts[i]);
                      await accountConnectedRaffle.enterRaffle({ value: entranceFee });
                  }
                  const startTimestamp = await raffle.getLatestTimestamp();
                  await new Promise(async (resolve, reject) => {
                      raffle.once("WinnerPicked", async () => {
                          try {
                              const recentWinner = await raffle.getRecentWinner();
                              const raffleState = await raffle.getRaffleState();
                              const endTimeStamp = await raffle.getLatestTimestamp();
                              const numPlayers = await raffle.getNumberOfPlayers();
                              const winnerEndingBalance = await accounts[1].getBalance();
                              assert.equal(numPlayers.toString(), "0");
                              assert.equal(raffleState.toString(), "0");
                              assert(endTimeStamp > startTimestamp);
                              assert.isNotNull(recentWinner);
                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance.add(entranceFee.mul(additionalEntrants + 1)).toString()
                              );
                              resolve();
                          } catch (e) {
                              reject(e);
                          }
                      });
                      const tx = await raffle.performUpkeep([]);
                      const txReceipt = await tx.wait(1);
                      const winnerStartingBalance = await accounts[1].getBalance();
                      await vrfCoordinatorV2Mock.fulfillRandomWords(txReceipt.events[1].args.requestId, raffle.address);
                  });
              });
          });
      });
