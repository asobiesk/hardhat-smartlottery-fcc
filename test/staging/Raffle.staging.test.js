const { assert, expect } = require("chai");
const { network, getNamedAccounts, deployments, ethers } = require("hardhat");
const { isCallTrace } = require("hardhat/internal/hardhat-network/stack-traces/message-trace");
const { developmentChains } = require("../../helper-hardhat-config");

developmentChains.includes(network.name.toLowerCase())
    ? describe.skip
    : describe("Raffle Staging Test", () => {
          let deployer, raffle, entranceFee;

          beforeEach(async () => {
              deployer = (await getNamedAccounts()).deployer;
              raffle = await ethers.getContract("Raffle", deployer);
              entranceFee = await raffle.getEntranceFee();
              console.log("Basic setup finished!");
          });

          it("works with live Chainlink Automation & VRF", async () => {
              const startTimestamp = await raffle.getLatestTimestamp();
              const accounts = await ethers.getSigners();
              await new Promise(async (resolve, reject) => {
                  raffle.once("WinnerPicked", async () => {
                      try {
                          const recentWinner = await raffle.getRecentWinner();
                          console.log(`Winner of the raffle is ${recentWinner}`);
                          const raffleState = await raffle.getRaffleState();
                          const endTimeStamp = await raffle.getLatestTimestamp();
                          const numPlayers = await raffle.getNumberOfPlayers();
                          const winnerEndingBalance = await accounts[0].getBalance();
                          assert.equal(numPlayers.toString(), "0");
                          assert.equal(raffleState.toString(), "0");
                          assert(endTimeStamp > startTimestamp);
                          assert.isNotNull(recentWinner);
                          assert.equal(
                              winnerEndingBalance.toString(),
                              winnerStartingBalance.add(entranceFee).toString()
                          );
                          resolve();
                      } catch (e) {
                          reject(e);
                      }
                  });
                  const tx = await raffle.enterRaffle({ value: entranceFee });
                  await tx.wait(1);
                  console.log("Raffle entered!");
                  const winnerStartingBalance = await accounts[0].getBalance();
                  console.log("Winner starting balance is ", winnerStartingBalance.toString());
              });
          });
      });
