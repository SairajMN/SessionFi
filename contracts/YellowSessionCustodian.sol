// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title YellowSessionCustodian
 * @notice Custodian contract for Yellow Network / SessionFi state channels
 * @dev Implements state channel pattern with challenge-response mechanism
 * 
 * Features:
 * - ERC20 token deposits
 * - Off-chain state updates
 * - On-chain settlement with signature verification
 * - Challenge mechanism for dispute resolution
 * - Force close after challenge period
 */
contract YellowSessionCustodian is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ========================================================================
    // DATA STRUCTURES
    // ========================================================================

    /**
     * @notice Represents a state channel between two parties
     */
    struct Channel {
        address user;
        address counterparty;
        address token;
        uint256 userDeposit;
        uint256 counterpartyDeposit;
        uint256 nonce;
        uint256 challengePeriod;
        uint256 challengeExpiry;
        bool isOpen;
        bool challenged;
    }

    /**
     * @notice Represents a pending settlement during challenge period
     */
    struct PendingSettlement {
        uint256 userBalance;
        uint256 counterpartyBalance;
        uint256 nonce;
        uint256 expiresAt;
    }

    // ========================================================================
    // STATE VARIABLES
    // ========================================================================

    /// @notice All channels by ID
    mapping(bytes32 => Channel) public channels;

    /// @notice Pending settlements during challenge period
    mapping(bytes32 => PendingSettlement) public pendingSettlements;

    /// @notice Minimum challenge period (1 hour)
    uint256 public constant MIN_CHALLENGE_PERIOD = 1 hours;

    /// @notice Maximum challenge period (7 days)
    uint256 public constant MAX_CHALLENGE_PERIOD = 7 days;

    /// @notice Default challenge period (24 hours)
    uint256 public constant DEFAULT_CHALLENGE_PERIOD = 24 hours;

    // ========================================================================
    // EVENTS
    // ========================================================================

    event ChannelOpened(
        bytes32 indexed channelId,
        address indexed user,
        address indexed counterparty,
        address token,
        uint256 deposit,
        uint256 challengePeriod
    );

    event CounterpartyDeposited(
        bytes32 indexed channelId,
        uint256 amount
    );

    event ChannelSettled(
        bytes32 indexed channelId,
        uint256 userFinal,
        uint256 counterpartyFinal,
        uint256 nonce
    );

    event ChallengeFiled(
        bytes32 indexed channelId,
        address indexed challenger,
        uint256 nonce,
        uint256 expiresAt
    );

    event ChallengeResponded(
        bytes32 indexed channelId,
        uint256 newNonce
    );

    event ChannelForceClosed(
        bytes32 indexed channelId,
        uint256 userFinal,
        uint256 counterpartyFinal
    );

    // ========================================================================
    // ERRORS
    // ========================================================================

    error ChannelNotFound();
    error ChannelClosed();
    error ChannelAlreadyExists();
    error InvalidChallengePeriod();
    error InvalidSignature();
    error InvalidNonce();
    error InvalidBalances();
    error ChallengeInProgress();
    error NoChallengeInProgress();
    error ChallengePeriodNotExpired();
    error NotChannelParticipant();
    error InsufficientDeposit();

    // ========================================================================
    // MODIFIERS
    // ========================================================================

    modifier onlyChannelParticipant(bytes32 channelId) {
        Channel storage channel = channels[channelId];
        if (msg.sender != channel.user && msg.sender != channel.counterparty) {
            revert NotChannelParticipant();
        }
        _;
    }

    modifier channelExists(bytes32 channelId) {
        if (channels[channelId].user == address(0)) {
            revert ChannelNotFound();
        }
        _;
    }

    modifier channelOpen(bytes32 channelId) {
        if (!channels[channelId].isOpen) {
            revert ChannelClosed();
        }
        _;
    }

    // ========================================================================
    // CONSTRUCTOR
    // ========================================================================

    constructor() Ownable(msg.sender) {}

    // ========================================================================
    // CHANNEL LIFECYCLE
    // ========================================================================

    /**
     * @notice Open a new state channel with an ERC20 deposit
     * @param counterparty Address of the counterparty (usually the engine)
     * @param token ERC20 token address to deposit
     * @param deposit Amount to deposit
     * @param challengePeriod Challenge period in seconds
     * @return channelId Unique channel identifier
     */
    function openChannel(
        address counterparty,
        address token,
        uint256 deposit,
        uint256 challengePeriod
    ) external nonReentrant returns (bytes32 channelId) {
        // Validate challenge period
        if (challengePeriod < MIN_CHALLENGE_PERIOD || challengePeriod > MAX_CHALLENGE_PERIOD) {
            revert InvalidChallengePeriod();
        }

        // Generate unique channel ID
        channelId = keccak256(
            abi.encodePacked(
                msg.sender,
                counterparty,
                token,
                block.timestamp,
                block.number
            )
        );

        // Check channel doesn't exist
        if (channels[channelId].user != address(0)) {
            revert ChannelAlreadyExists();
        }

        // Transfer tokens from user
        IERC20(token).safeTransferFrom(msg.sender, address(this), deposit);

        // Create channel
        channels[channelId] = Channel({
            user: msg.sender,
            counterparty: counterparty,
            token: token,
            userDeposit: deposit,
            counterpartyDeposit: 0,
            nonce: 0,
            challengePeriod: challengePeriod,
            challengeExpiry: 0,
            isOpen: true,
            challenged: false
        });

        emit ChannelOpened(
            channelId,
            msg.sender,
            counterparty,
            token,
            deposit,
            challengePeriod
        );

        return channelId;
    }

    /**
     * @notice Allow counterparty to deposit into an existing channel
     * @param channelId Channel to deposit into
     * @param amount Amount to deposit
     */
    function depositCounterparty(
        bytes32 channelId,
        uint256 amount
    ) external nonReentrant channelExists(channelId) channelOpen(channelId) {
        Channel storage channel = channels[channelId];
        
        if (msg.sender != channel.counterparty) {
            revert NotChannelParticipant();
        }

        IERC20(channel.token).safeTransferFrom(msg.sender, address(this), amount);
        channel.counterpartyDeposit += amount;

        emit CounterpartyDeposited(channelId, amount);
    }

    // ========================================================================
    // SETTLEMENT
    // ========================================================================

    /**
     * @notice Settle a channel cooperatively with both signatures
     * @param channelId Channel to settle
     * @param userFinal Final balance for user
     * @param counterpartyFinal Final balance for counterparty
     * @param nonce State nonce
     * @param userSig User's signature over state hash
     * @param counterpartySig Counterparty's signature over state hash
     */
    function settle(
        bytes32 channelId,
        uint256 userFinal,
        uint256 counterpartyFinal,
        uint256 nonce,
        bytes memory userSig,
        bytes memory counterpartySig
    ) external nonReentrant channelExists(channelId) channelOpen(channelId) {
        Channel storage channel = channels[channelId];

        // Validate balances don't exceed deposits
        uint256 totalDeposits = channel.userDeposit + channel.counterpartyDeposit;
        if (userFinal + counterpartyFinal > totalDeposits) {
            revert InvalidBalances();
        }

        // Validate nonce is newer
        if (nonce <= channel.nonce) {
            revert InvalidNonce();
        }

        // Compute state hash
        bytes32 stateHash = keccak256(
            abi.encodePacked(
                channelId,
                userFinal,
                counterpartyFinal,
                nonce,
                true // isFinal
            )
        );

        // Verify signatures
        _verifySignature(stateHash, userSig, channel.user);
        _verifySignature(stateHash, counterpartySig, channel.counterparty);

        // Execute settlement
        _executeSettlement(channelId, userFinal, counterpartyFinal, nonce);
    }

    /**
     * @notice File a challenge with a signed state
     * @param channelId Channel to challenge
     * @param userBalance User balance in the state
     * @param counterpartyBalance Counterparty balance in the state
     * @param nonce State nonce
     * @param userSig User's signature
     * @param counterpartySig Counterparty's signature
     */
    function challenge(
        bytes32 channelId,
        uint256 userBalance,
        uint256 counterpartyBalance,
        uint256 nonce,
        bytes memory userSig,
        bytes memory counterpartySig
    ) external nonReentrant channelExists(channelId) channelOpen(channelId) onlyChannelParticipant(channelId) {
        Channel storage channel = channels[channelId];

        // Can't challenge if already challenged
        if (channel.challenged && block.timestamp < channel.challengeExpiry) {
            revert ChallengeInProgress();
        }

        // Validate nonce is newer than any existing challenge
        if (nonce <= channel.nonce) {
            revert InvalidNonce();
        }

        // Compute state hash
        bytes32 stateHash = keccak256(
            abi.encodePacked(
                channelId,
                userBalance,
                counterpartyBalance,
                nonce,
                false // not necessarily final
            )
        );

        // Verify signatures
        _verifySignature(stateHash, userSig, channel.user);
        _verifySignature(stateHash, counterpartySig, channel.counterparty);

        // Set challenge
        uint256 expiresAt = block.timestamp + channel.challengePeriod;
        channel.challenged = true;
        channel.challengeExpiry = expiresAt;
        channel.nonce = nonce;

        pendingSettlements[channelId] = PendingSettlement({
            userBalance: userBalance,
            counterpartyBalance: counterpartyBalance,
            nonce: nonce,
            expiresAt: expiresAt
        });

        emit ChallengeFiled(channelId, msg.sender, nonce, expiresAt);
    }

    /**
     * @notice Respond to a challenge with a newer state
     * @param channelId Channel being challenged
     * @param userBalance User balance in newer state
     * @param counterpartyBalance Counterparty balance in newer state
     * @param nonce Newer state nonce
     * @param userSig User's signature
     * @param counterpartySig Counterparty's signature
     */
    function respondToChallenge(
        bytes32 channelId,
        uint256 userBalance,
        uint256 counterpartyBalance,
        uint256 nonce,
        bytes memory userSig,
        bytes memory counterpartySig
    ) external nonReentrant channelExists(channelId) channelOpen(channelId) onlyChannelParticipant(channelId) {
        Channel storage channel = channels[channelId];

        if (!channel.challenged) {
            revert NoChallengeInProgress();
        }

        PendingSettlement storage pending = pendingSettlements[channelId];

        // Must have higher nonce
        if (nonce <= pending.nonce) {
            revert InvalidNonce();
        }

        // Compute state hash
        bytes32 stateHash = keccak256(
            abi.encodePacked(
                channelId,
                userBalance,
                counterpartyBalance,
                nonce,
                false
            )
        );

        // Verify signatures
        _verifySignature(stateHash, userSig, channel.user);
        _verifySignature(stateHash, counterpartySig, channel.counterparty);

        // Update pending settlement with newer state
        pending.userBalance = userBalance;
        pending.counterpartyBalance = counterpartyBalance;
        pending.nonce = nonce;
        pending.expiresAt = block.timestamp + channel.challengePeriod;
        channel.challengeExpiry = pending.expiresAt;
        channel.nonce = nonce;

        emit ChallengeResponded(channelId, nonce);
    }

    /**
     * @notice Force close a channel after challenge period expires
     * @param channelId Channel to force close
     */
    function forceClose(
        bytes32 channelId
    ) external nonReentrant channelExists(channelId) channelOpen(channelId) onlyChannelParticipant(channelId) {
        Channel storage channel = channels[channelId];

        if (!channel.challenged) {
            revert NoChallengeInProgress();
        }

        if (block.timestamp < channel.challengeExpiry) {
            revert ChallengePeriodNotExpired();
        }

        PendingSettlement storage pending = pendingSettlements[channelId];

        // Execute settlement with challenged state
        _executeSettlement(
            channelId,
            pending.userBalance,
            pending.counterpartyBalance,
            pending.nonce
        );

        emit ChannelForceClosed(
            channelId,
            pending.userBalance,
            pending.counterpartyBalance
        );
    }

    // ========================================================================
    // INTERNAL FUNCTIONS
    // ========================================================================

    /**
     * @notice Execute the settlement - transfer tokens and close channel
     */
    function _executeSettlement(
        bytes32 channelId,
        uint256 userFinal,
        uint256 counterpartyFinal,
        uint256 nonce
    ) internal {
        Channel storage channel = channels[channelId];

        // Mark channel as closed
        channel.isOpen = false;
        channel.nonce = nonce;

        // Transfer tokens
        if (userFinal > 0) {
            IERC20(channel.token).safeTransfer(channel.user, userFinal);
        }
        if (counterpartyFinal > 0) {
            IERC20(channel.token).safeTransfer(channel.counterparty, counterpartyFinal);
        }

        emit ChannelSettled(channelId, userFinal, counterpartyFinal, nonce);
    }

    /**
     * @notice Verify a signature matches the expected signer
     */
    function _verifySignature(
        bytes32 stateHash,
        bytes memory signature,
        address expectedSigner
    ) internal pure {
        bytes32 ethSignedHash = stateHash.toEthSignedMessageHash();
        address recoveredSigner = ethSignedHash.recover(signature);
        
        if (recoveredSigner != expectedSigner) {
            revert InvalidSignature();
        }
    }

    // ========================================================================
    // VIEW FUNCTIONS
    // ========================================================================

    /**
     * @notice Get channel details
     */
    function getChannel(bytes32 channelId) external view returns (
        address user,
        address counterparty,
        address token,
        uint256 userDeposit,
        uint256 counterpartyDeposit,
        uint256 nonce,
        uint256 challengePeriod,
        uint256 challengeExpiry,
        bool isOpen,
        bool challenged
    ) {
        Channel storage channel = channels[channelId];
        return (
            channel.user,
            channel.counterparty,
            channel.token,
            channel.userDeposit,
            channel.counterpartyDeposit,
            channel.nonce,
            channel.challengePeriod,
            channel.challengeExpiry,
            channel.isOpen,
            channel.challenged
        );
    }

    /**
     * @notice Get pending settlement details
     */
    function getPendingSettlement(bytes32 channelId) external view returns (
        uint256 userBalance,
        uint256 counterpartyBalance,
        uint256 nonce,
        uint256 expiresAt
    ) {
        PendingSettlement storage pending = pendingSettlements[channelId];
        return (
            pending.userBalance,
            pending.counterpartyBalance,
            pending.nonce,
            pending.expiresAt
        );
    }

    /**
     * @notice Check if a channel exists and is open
     */
    function isChannelOpen(bytes32 channelId) external view returns (bool) {
        return channels[channelId].isOpen;
    }

    /**
     * @notice Get total deposits in a channel
     */
    function getTotalDeposits(bytes32 channelId) external view returns (uint256) {
        Channel storage channel = channels[channelId];
        return channel.userDeposit + channel.counterpartyDeposit;
    }
}
