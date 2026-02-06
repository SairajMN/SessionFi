// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SessionFiHook
 * @notice Uniswap v4 Hook for session-based AMM interactions
 * @dev This is a standalone contract that can be integrated with Uniswap v4 PoolManager
 *      when deployed. For testing without v4-core, it provides session management.
 *
 * Key Features:
 * - Session creation with locked capital
 * - Intent-based swap validation
 * - Fee rebates for high-volume sessions
 * - Cryptographic state verification
 */
contract SessionFiHook is ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // =========================================================================
    // STRUCTS
    // =========================================================================

    struct Session {
        address owner;
        bytes32 stateHash;
        uint256 nonce;
        uint256 lockedAmount;
        uint256 availableAmount;
        uint256 totalVolume;
        uint256 createdAt;
        uint256 expiresAt;
        bool isActive;
    }

    struct SwapIntent {
        bytes32 sessionId;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        uint256 deadline;
        bytes signature;
    }

    // =========================================================================
    // STATE VARIABLES
    // =========================================================================

    // Session storage
    mapping(bytes32 => Session) public sessions;
    mapping(address => bytes32[]) public userSessions;
    
    // Token balances per session
    mapping(bytes32 => mapping(address => uint256)) public sessionBalances;
    
    // Intent tracking
    mapping(bytes32 => bool) public executedIntents;
    
    // Fee configuration (in basis points)
    uint256 public constant BASE_FEE = 30; // 0.30%
    uint256 public constant HIGH_VOLUME_FEE = 25; // 0.25%
    uint256 public constant HIGH_VOLUME_THRESHOLD = 1000000 * 10**6; // $1M in USDC decimals
    
    // =========================================================================
    // EVENTS
    // =========================================================================

    event SessionCreated(
        bytes32 indexed sessionId,
        address indexed owner,
        uint256 lockedAmount,
        uint256 expiresAt
    );
    
    event SessionDeposit(
        bytes32 indexed sessionId,
        address indexed token,
        uint256 amount
    );
    
    event SwapExecutedInSession(
        bytes32 indexed sessionId,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee
    );
    
    event SessionSettled(
        bytes32 indexed sessionId,
        bytes32 finalStateHash,
        uint256 totalVolume
    );
    
    event IntentExecuted(
        bytes32 indexed sessionId,
        bytes32 indexed intentHash,
        bool success
    );

    // =========================================================================
    // MODIFIERS
    // =========================================================================

    modifier onlySessionOwner(bytes32 sessionId) {
        require(sessions[sessionId].owner == msg.sender, "Not session owner");
        _;
    }

    modifier sessionActive(bytes32 sessionId) {
        require(sessions[sessionId].isActive, "Session not active");
        require(block.timestamp < sessions[sessionId].expiresAt, "Session expired");
        _;
    }

    // =========================================================================
    // SESSION MANAGEMENT
    // =========================================================================

    /**
     * @notice Create a new trading session
     * @param duration Session duration in seconds
     * @return sessionId The unique session identifier
     */
    function createSession(uint256 duration) external returns (bytes32 sessionId) {
        require(duration > 0 && duration <= 30 days, "Invalid duration");
        
        sessionId = keccak256(
            abi.encodePacked(
                msg.sender,
                block.timestamp,
                block.number,
                userSessions[msg.sender].length
            )
        );
        
        sessions[sessionId] = Session({
            owner: msg.sender,
            stateHash: bytes32(0),
            nonce: 0,
            lockedAmount: 0,
            availableAmount: 0,
            totalVolume: 0,
            createdAt: block.timestamp,
            expiresAt: block.timestamp + duration,
            isActive: true
        });
        
        userSessions[msg.sender].push(sessionId);
        
        emit SessionCreated(sessionId, msg.sender, 0, block.timestamp + duration);
    }

    /**
     * @notice Deposit tokens into a session
     * @param sessionId The session to deposit into
     * @param token The token address
     * @param amount The amount to deposit
     */
    function depositToSession(
        bytes32 sessionId,
        address token,
        uint256 amount
    ) external onlySessionOwner(sessionId) sessionActive(sessionId) nonReentrant {
        require(amount > 0, "Zero amount");
        
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        
        sessionBalances[sessionId][token] += amount;
        sessions[sessionId].lockedAmount += amount;
        sessions[sessionId].availableAmount += amount;
        
        // Update state hash
        _updateStateHash(sessionId);
        
        emit SessionDeposit(sessionId, token, amount);
    }

    /**
     * @notice Execute a swap within a session (simulated - would integrate with v4 PoolManager)
     * @param intent The swap intent to execute
     */
    function executeSwapIntent(
        SwapIntent calldata intent
    ) external sessionActive(intent.sessionId) nonReentrant {
        Session storage session = sessions[intent.sessionId];
        
        // Verify intent hasn't been executed
        bytes32 intentHash = _hashIntent(intent);
        require(!executedIntents[intentHash], "Intent already executed");
        
        // Verify deadline
        require(block.timestamp <= intent.deadline, "Intent expired");
        
        // Verify signature
        require(
            _verifyIntentSignature(intent, intentHash),
            "Invalid signature"
        );
        
        // Verify balance
        require(
            sessionBalances[intent.sessionId][intent.tokenIn] >= intent.amountIn,
            "Insufficient balance"
        );
        
        // Calculate fee
        uint256 fee = _calculateFee(session.totalVolume, intent.amountIn);
        uint256 amountAfterFee = intent.amountIn - fee;
        
        // Simulate swap output (in production, this would call the PoolManager)
        // For MVP, we use a 1:1 ratio minus fee
        uint256 amountOut = amountAfterFee;
        require(amountOut >= intent.minAmountOut, "Slippage too high");
        
        // Update balances
        sessionBalances[intent.sessionId][intent.tokenIn] -= intent.amountIn;
        sessionBalances[intent.sessionId][intent.tokenOut] += amountOut;
        
        // Update session state
        session.totalVolume += intent.amountIn;
        session.nonce++;
        _updateStateHash(intent.sessionId);
        
        // Mark intent as executed
        executedIntents[intentHash] = true;
        
        emit SwapExecutedInSession(
            intent.sessionId,
            intent.tokenIn,
            intent.tokenOut,
            intent.amountIn,
            amountOut,
            fee
        );
        
        emit IntentExecuted(intent.sessionId, intentHash, true);
    }

    /**
     * @notice Settle and close a session
     * @param sessionId The session to settle
     * @param finalStateHash The expected final state hash for verification
     */
    function settleSession(
        bytes32 sessionId,
        bytes32 finalStateHash
    ) external onlySessionOwner(sessionId) nonReentrant {
        Session storage session = sessions[sessionId];
        require(session.isActive, "Session not active");
        
        // Verify state hash matches
        require(session.stateHash == finalStateHash, "State hash mismatch");
        
        session.isActive = false;
        
        emit SessionSettled(sessionId, finalStateHash, session.totalVolume);
    }

    /**
     * @notice Withdraw tokens after session settlement
     * @param sessionId The settled session
     * @param token The token to withdraw
     */
    function withdrawFromSession(
        bytes32 sessionId,
        address token
    ) external onlySessionOwner(sessionId) nonReentrant {
        require(!sessions[sessionId].isActive, "Session still active");
        
        uint256 balance = sessionBalances[sessionId][token];
        require(balance > 0, "No balance");
        
        sessionBalances[sessionId][token] = 0;
        
        IERC20(token).transfer(msg.sender, balance);
    }

    /**
     * @notice Force close an expired session
     * @param sessionId The expired session
     */
    function forceCloseSession(bytes32 sessionId) external onlySessionOwner(sessionId) {
        Session storage session = sessions[sessionId];
        require(session.isActive, "Session not active");
        require(block.timestamp >= session.expiresAt, "Session not expired");
        
        session.isActive = false;
        
        emit SessionSettled(sessionId, session.stateHash, session.totalVolume);
    }

    // =========================================================================
    // VIEW FUNCTIONS
    // =========================================================================

    /**
     * @notice Get session details
     */
    function getSession(bytes32 sessionId) external view returns (
        address owner,
        bytes32 stateHash,
        uint256 nonce,
        uint256 lockedAmount,
        uint256 availableAmount,
        uint256 totalVolume,
        uint256 createdAt,
        uint256 expiresAt,
        bool isActive
    ) {
        Session storage s = sessions[sessionId];
        return (
            s.owner,
            s.stateHash,
            s.nonce,
            s.lockedAmount,
            s.availableAmount,
            s.totalVolume,
            s.createdAt,
            s.expiresAt,
            s.isActive
        );
    }

    /**
     * @notice Get session token balance
     */
    function getSessionBalance(
        bytes32 sessionId,
        address token
    ) external view returns (uint256) {
        return sessionBalances[sessionId][token];
    }

    /**
     * @notice Get all sessions for a user
     */
    function getUserSessions(address user) external view returns (bytes32[] memory) {
        return userSessions[user];
    }

    /**
     * @notice Calculate the fee for a given volume and amount
     */
    function calculateFee(
        uint256 totalVolume,
        uint256 amount
    ) external pure returns (uint256) {
        return _calculateFee(totalVolume, amount);
    }

    // =========================================================================
    // INTERNAL FUNCTIONS
    // =========================================================================

    function _calculateFee(
        uint256 totalVolume,
        uint256 amount
    ) internal pure returns (uint256) {
        uint256 feeRate = totalVolume >= HIGH_VOLUME_THRESHOLD 
            ? HIGH_VOLUME_FEE 
            : BASE_FEE;
        return (amount * feeRate) / 10000;
    }

    function _updateStateHash(bytes32 sessionId) internal {
        Session storage session = sessions[sessionId];
        session.stateHash = keccak256(
            abi.encodePacked(
                sessionId,
                session.nonce,
                session.totalVolume,
                session.availableAmount,
                block.timestamp
            )
        );
    }

    function _hashIntent(SwapIntent calldata intent) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                intent.sessionId,
                intent.tokenIn,
                intent.tokenOut,
                intent.amountIn,
                intent.minAmountOut,
                intent.deadline
            )
        );
    }

    function _verifyIntentSignature(
        SwapIntent calldata intent,
        bytes32 intentHash
    ) internal view returns (bool) {
        address signer = intentHash.toEthSignedMessageHash().recover(intent.signature);
        return signer == sessions[intent.sessionId].owner;
    }
}
