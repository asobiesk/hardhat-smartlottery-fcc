const { network, ethers } = require("hardhat");
const { developmentChains, networkConfig } = require("../helper-hardhat-config");
const { verify } = require("../utils/verify");
require("dotenv").config();

const VRF_SUB_FUND_AMOUNT = ethers.utils.parseEther("2");

module.exports = async ({ getNamedAccounts, deployments }) => {
    const { deploy, log } = deployments;
    const { deployer } = await getNamedAccounts();
    const { chainId } = network.config;
    let vrfCoordinatorV2Address, subscriptionId;

    if (developmentChains.includes(network.name.toLowerCase())) {
        const vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock");
        vrfCoordinatorV2Address = vrfCoordinatorV2Mock.address;
        subscriptionId = await createVrfSubscription(vrfCoordinatorV2Mock);
        await vrfCoordinatorV2Mock.fundSubscription(subscriptionId, VRF_SUB_FUND_AMOUNT);
    } else {
        vrfCoordinatorV2Address = networkConfig[chainId].vrfCoordinatorV2;
        subscriptionId = networkConfig[chainId].subscriptionId;
    }

    const { entranceFee, gasLane, callbackGasLimit, interval } = networkConfig[chainId];

    const args = [vrfCoordinatorV2Address, entranceFee, gasLane, subscriptionId, callbackGasLimit, interval];

    const raffle = await deploy("Raffle", {
        from: deployer,
        args: args,
        log: true,
        waitConfirmations: network.config.blockConfirmations ?? 1,
    });

    if (developmentChains.includes(network.name.toLowerCase())) {
        const vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock");
        await vrfCoordinatorV2Mock.addConsumer(subscriptionId, raffle.address);
    }

    if (!developmentChains.includes(network.name.toLowerCase()) && process.env.ETHERSCAN_API_KEY) {
        log("Verifying...");
        await verify(raffle.address, args);
        log("Verified!");
        log("-".repeat(200));
    }
};

createVrfSubscription = async (vrfCoordinatorV2) => {
    const transactionResponse = await vrfCoordinatorV2.createSubscription();
    const transactionReceipt = await transactionResponse.wait(1);
    return transactionReceipt.events[0].args.subId;
};

module.exports.tags = ["all", "raffle"];
