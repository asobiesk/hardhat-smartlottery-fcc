//SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/AutomationCompatible.sol";

error Raffle__InsufficientFunds();
error Raffle__TransferError();
error Raffle__NotOpen();
error Raffle__UpkeepNotNeeded();

/**
 * @title A sample Raffle Contract
 * @author Adam Sobieski
 * @notice This contract is for creating an untamperable decentralized smart contract for lottery
 * @dev This implementes Chainlink VRF v2 and Chainlink Automation
 */
contract Raffle is VRFConsumerBaseV2, AutomationCompatibleInterface {
    //Type declarations
    enum RaffleState {
        OPEN,
        CALCULATING
    }

    //State Variables
    uint16 private constant REQUEST_CONFIRMATIONS = 3;
    uint32 private constant NUM_WORDS = 1;
    uint256 private immutable i_entranceFee;
    address payable[] private s_players;
    VRFCoordinatorV2Interface private immutable i_vrfCoordinator;
    bytes32 private immutable i_gaseLane;
    uint64 private immutable i_subscriptionId;
    uint32 private immutable i_callbackGasLimit;

    //Lottery-specific variables
    address private s_recentWinner;
    RaffleState private s_raffleState;
    uint256 private s_lastTimeStamp;
    uint256 private immutable i_interval;

    //Events
    event RaffleEnter(address indexed player);
    event RequestedRaffleWinner(uint256 indexed requestId);
    event WinnerPicked(address indexed winner);

    //Functions
    constructor(
        address _vrfCoordinatorV2,
        uint256 _entranceFee,
        bytes32 _gaseLane,
        uint64 _subscriptionId,
        uint32 _callbackGasLimit,
        uint256 _interval
    ) VRFConsumerBaseV2(_vrfCoordinatorV2) {
        i_entranceFee = _entranceFee;
        i_vrfCoordinator = VRFCoordinatorV2Interface(_vrfCoordinatorV2);
        i_gaseLane = _gaseLane;
        i_subscriptionId = _subscriptionId;
        i_callbackGasLimit = _callbackGasLimit;
        s_raffleState = RaffleState.OPEN;
        s_lastTimeStamp = block.timestamp;
        i_interval = _interval;
    }

    function enterRaffle() public payable {
        if (msg.value < i_entranceFee) revert Raffle__InsufficientFunds();
        if (s_raffleState != RaffleState.OPEN) revert Raffle__NotOpen();
        s_players.push(payable(msg.sender));
        emit RaffleEnter(msg.sender);
    }

    /**
     * @dev Method executed off-chain by Chainlink Automation to determine if the schedule/conditions are currently met
     * and thus the performUpkeep() should be executed
     * The following should be true for the method to return true:
     * 1. Time interval passed
     * 2. Lottery has at least 1 player
     * 3. Subscription is funded with LINK
     * 4. Lottery should be in "open" state
     */
    function checkUpkeep(
        bytes memory /*checkData*/
    ) public view override returns (bool, bytes memory) {
        bool isOpen = (s_raffleState == RaffleState.OPEN);
        bool timePassed = ((block.timestamp - s_lastTimeStamp) > i_interval);
        bool hasPlayers = (s_players.length > 0);
        bool hasBalance = address(this).balance > 0;
        bool upkeepNeeded = (isOpen && timePassed && hasPlayers && hasBalance);
        return (upkeepNeeded, "");
    }

    function performUpkeep(bytes calldata /*performData*/) external {
        (bool upkeepNeeded, ) = checkUpkeep("");
        if (!upkeepNeeded) {
            revert Raffle__UpkeepNotNeeded();
        }
        s_raffleState = RaffleState.CALCULATING;
        uint256 requestId = i_vrfCoordinator.requestRandomWords(
            i_gaseLane,
            i_subscriptionId,
            REQUEST_CONFIRMATIONS,
            i_callbackGasLimit,
            NUM_WORDS
        );
        emit RequestedRaffleWinner(requestId);
    }

    function fulfillRandomWords(
        uint256 /*requestId*/,
        uint256[] memory randomWords
    ) internal override {
        uint256 indexOfWinner = randomWords[0] % s_players.length;
        address payable recentWinner = s_players[indexOfWinner];
        s_recentWinner = recentWinner;
        s_raffleState = RaffleState.OPEN;
        s_players = new address payable[](0);
        s_lastTimeStamp = block.timestamp;
        (bool success, ) = recentWinner.call{value: address(this).balance}("");
        if (!success) {
            revert Raffle__TransferError();
        }
        emit WinnerPicked(recentWinner);
    }

    // View / Pure functions

    function getEntranceFee() public view returns (uint256) {
        return i_entranceFee;
    }

    function getPlayer(uint256 _index) public view returns (address) {
        return s_players[_index];
    }

    function getRecentWinner() public view returns (address) {
        return s_recentWinner;
    }

    function getRaffleState() public view returns (RaffleState) {
        return s_raffleState;
    }

    function getNumberOfPlayers() public view returns (uint256) {
        return s_players.length;
    }

    function getLatestTimestamp() public view returns (uint256) {
        return s_lastTimeStamp;
    }

    function getInterval() public view returns (uint256) {
        return i_interval;
    }

    function getNumWords() public pure returns (uint32) {
        return NUM_WORDS;
    }
}
