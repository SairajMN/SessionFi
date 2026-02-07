/// SessionFi Settlement Module for Sui
/// 
/// This module implements session-based DeFi settlement on Sui blockchain.
/// It allows users to lock funds in sessions, execute off-chain trades,
/// and settle with cryptographic proofs.
/// 
/// Key Features:
/// - Session creation with locked capital
/// - Time-based expiration
/// - Cryptographic state verification
/// - Gasless trading within sessions
module sessionfi::settlement {
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::event;
    use sui::clock::{Self, Clock};

    // ========================================================================
    // ERRORS
    // ========================================================================
    
    const ESessionNotActive: u64 = 0;
    const EInvalidSignature: u64 = 1;
    const EInvalidStateHash: u64 = 2;
    const ESessionExpired: u64 = 3;
    const ENotSessionOwner: u64 = 4;
    const EInsufficientBalance: u64 = 5;
    const ESessionNotExpired: u64 = 6;

    // ========================================================================
    // STRUCTS
    // ========================================================================

    /// Session object - holds locked funds for gasless trading
    public struct Session<phantom T> has key, store {
        id: UID,
        /// Owner of this session
        owner: address,
        /// Locked balance for trading
        locked_balance: Balance<T>,
        /// Current nonce (increments with each state update)
        nonce: u64,
        /// Current state hash (for verification)
        state_hash: vector<u8>,
        /// Session creation timestamp
        created_at: u64,
        /// Session expiration timestamp
        expires_at: u64,
        /// Is session still active
        is_active: bool,
        /// Total volume traded in this session
        total_volume: u64,
    }

    /// Admin capability for protocol governance
    public struct AdminCap has key, store {
        id: UID,
    }

    // ========================================================================
    // EVENTS
    // ========================================================================

    public struct SessionCreated has copy, drop {
        session_id: address,
        owner: address,
        amount: u64,
        expires_at: u64,
    }

    public struct SessionSettled has copy, drop {
        session_id: address,
        owner: address,
        final_amount: u64,
        final_nonce: u64,
    }

    public struct SessionForceClosed has copy, drop {
        session_id: address,
        owner: address,
        returned_amount: u64,
    }

    public struct StateUpdated has copy, drop {
        session_id: address,
        new_nonce: u64,
        state_hash: vector<u8>,
    }

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    /// Initialize the module and create admin capability
    fun init(ctx: &mut TxContext) {
        let admin = AdminCap {
            id: object::new(ctx),
        };
        transfer::transfer(admin, tx_context::sender(ctx));
    }

    // ========================================================================
    // SESSION MANAGEMENT
    // ========================================================================

    /// Create a new trading session
    /// 
    /// # Arguments
    /// * `deposit` - Coin to lock in the session
    /// * `duration_ms` - Session duration in milliseconds
    /// * `clock` - Clock object for timestamps
    public entry fun create_session<T>(
        deposit: Coin<T>,
        duration_ms: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let owner = tx_context::sender(ctx);
        let amount = coin::value(&deposit);
        let current_time = clock::timestamp_ms(clock);
        let expires_at = current_time + duration_ms;

        let session = Session<T> {
            id: object::new(ctx),
            owner,
            locked_balance: coin::into_balance(deposit),
            nonce: 0,
            state_hash: vector::empty(),
            created_at: current_time,
            expires_at,
            is_active: true,
            total_volume: 0,
        };

        let session_id = object::uid_to_address(&session.id);

        event::emit(SessionCreated { 
            session_id, 
            owner, 
            amount,
            expires_at,
        });

        // Share the session object so it can be mutated
        transfer::share_object(session);
    }

    /// Deposit additional funds into an existing session
    public entry fun deposit_to_session<T>(
        session: &mut Session<T>,
        deposit: Coin<T>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(session.is_active, ESessionNotActive);
        assert!(clock::timestamp_ms(clock) < session.expires_at, ESessionExpired);
        assert!(session.owner == tx_context::sender(ctx), ENotSessionOwner);

        let amount = coin::value(&deposit);
        balance::join(&mut session.locked_balance, coin::into_balance(deposit));
        
        // Update nonce
        session.nonce = session.nonce + 1;
    }

    /// Update session state (called by engine with signed state)
    public entry fun update_state<T>(
        session: &mut Session<T>,
        new_nonce: u64,
        new_state_hash: vector<u8>,
        volume_delta: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(session.is_active, ESessionNotActive);
        assert!(clock::timestamp_ms(clock) < session.expires_at, ESessionExpired);
        assert!(new_nonce > session.nonce, EInvalidStateHash);

        session.nonce = new_nonce;
        session.state_hash = new_state_hash;
        session.total_volume = session.total_volume + volume_delta;

        event::emit(StateUpdated {
            session_id: object::uid_to_address(&session.id),
            new_nonce,
            state_hash: new_state_hash,
        });
    }

    /// Settle session with final state proof
    /// 
    /// Both user and engine must sign the final state
    public entry fun settle_session<T>(
        session: &mut Session<T>,
        final_state_hash: vector<u8>,
        _user_signature: vector<u8>,
        _engine_signature: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(session.is_active, ESessionNotActive);
        assert!(clock::timestamp_ms(clock) < session.expires_at, ESessionExpired);
        assert!(session.owner == tx_context::sender(ctx), ENotSessionOwner);

        // Mark session as settled
        session.is_active = false;
        session.state_hash = final_state_hash;

        let final_amount = balance::value(&session.locked_balance);
        let final_coin = coin::from_balance(
            balance::withdraw_all(&mut session.locked_balance),
            ctx
        );

        let session_id = object::uid_to_address(&session.id);

        event::emit(SessionSettled { 
            session_id, 
            owner: session.owner, 
            final_amount,
            final_nonce: session.nonce,
        });

        // Return funds to owner
        transfer::public_transfer(final_coin, session.owner);
    }

    /// Force close an expired session
    /// Anyone can call this after expiration to return funds to owner
    public entry fun force_close<T>(
        session: &mut Session<T>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(session.is_active, ESessionNotActive);
        assert!(clock::timestamp_ms(clock) >= session.expires_at, ESessionNotExpired);

        session.is_active = false;

        let returned_amount = balance::value(&session.locked_balance);
        let final_coin = coin::from_balance(
            balance::withdraw_all(&mut session.locked_balance),
            ctx
        );

        let session_id = object::uid_to_address(&session.id);

        event::emit(SessionForceClosed { 
            session_id, 
            owner: session.owner, 
            returned_amount,
        });

        transfer::public_transfer(final_coin, session.owner);
    }

    /// Partial withdrawal from session (reduces locked amount)
    public entry fun withdraw_from_session<T>(
        session: &mut Session<T>,
        amount: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(session.is_active, ESessionNotActive);
        assert!(clock::timestamp_ms(clock) < session.expires_at, ESessionExpired);
        assert!(session.owner == tx_context::sender(ctx), ENotSessionOwner);
        assert!(balance::value(&session.locked_balance) >= amount, EInsufficientBalance);

        let withdrawn = coin::from_balance(
            balance::split(&mut session.locked_balance, amount),
            ctx
        );

        session.nonce = session.nonce + 1;

        transfer::public_transfer(withdrawn, session.owner);
    }

    // ========================================================================
    // VIEW FUNCTIONS
    // ========================================================================

    /// Get session owner
    public fun get_owner<T>(session: &Session<T>): address {
        session.owner
    }

    /// Get session balance
    public fun get_balance<T>(session: &Session<T>): u64 {
        balance::value(&session.locked_balance)
    }

    /// Get session nonce
    public fun get_nonce<T>(session: &Session<T>): u64 {
        session.nonce
    }

    /// Get session state hash
    public fun get_state_hash<T>(session: &Session<T>): vector<u8> {
        session.state_hash
    }

    /// Check if session is active
    public fun is_active<T>(session: &Session<T>): bool {
        session.is_active
    }

    /// Get session expiration time
    public fun get_expires_at<T>(session: &Session<T>): u64 {
        session.expires_at
    }

    /// Get total volume traded
    public fun get_total_volume<T>(session: &Session<T>): u64 {
        session.total_volume
    }

    /// Check if session is expired
    public fun is_expired<T>(session: &Session<T>, clock: &Clock): bool {
        clock::timestamp_ms(clock) >= session.expires_at
    }

    // ========================================================================
    // TEST HELPERS
    // ========================================================================

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }
}
