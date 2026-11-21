// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAgentID {
    function balanceOf(address owner) external view returns (uint256);
}

/// @title Turncoat: a public proving ground for AI wallet agents
/// @notice A guard agent holds a pot. Agent ID holders send it one message per attempt.
///         If the guard takes a forbidden action, the guard service signs a verdict and this
///         contract pays the pot to the attacker who sent that attempt.
/// @dev Owner powers (complete list, see README): open and seed rounds, set the guard signer for
///      rounds opened later, withdraw the running-cost share, pause the opening of new rounds,
///      transfer ownership. The owner can never withdraw a pot, pause attempts or payouts in a
///      live round, or change a round after it opens, including the signer whose verdict pays it.
///      Trust that remains: a round pays whoever its signer signs for. The signer is fixed when the
///      round opens and is public (`roundSigner`), but the contract cannot check that a signed
///      verdict matches a real break. That is checked off-chain against the public transcript.
contract Turncoat is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------ constants
    bytes32 public constant VERDICT_TYPEHASH =
        keccak256("Verdict(uint256 roundId,uint256 attemptId,address attacker)");

    uint256 public constant POT_BPS = 7000; // of each paid fee
    uint256 public constant RESERVE_BPS = 1500; // seeds later rounds; the rest (15%) is running costs
    uint256 public constant FEE_STEP_BPS = 1000; // each paid attempt by the same ID in a round costs +10% of base
    uint256 public constant MAX_FEE_BPS = 50000; // capped at 5x base
    uint64 public constant MIN_DURATION = 1 hours;
    uint64 public constant MAX_DURATION = 30 days;
    /// @notice After a round ends, verdicts for attempts made in time can still be settled for this long.
    uint64 public constant SETTLE_GRACE = 1 days;

    IAgentID public immutable agentId;
    IERC20 public immutable token;

    // ------------------------------------------------------------ state
    struct Round {
        uint8 level;
        bool paidEnabled; // extra paid attempts on or off for this round, fixed at open
        bool closed; // true once paid out or rolled over
        uint64 startTime;
        uint64 endTime;
        uint96 baseFee;
        uint32 attemptCount;
        uint32 winningAttempt;
        address winner;
        bytes32 guardCommit; // keccak256(salt, guard instructions), fixed at open
        uint256 pot;
    }

    struct Attempt {
        address attacker;
        bool paid;
        uint64 time;
        bytes32 messageHash;
    }

    address public owner;
    address public pendingOwner;
    /// @notice Signer given to rounds opened from now on. Rounds already open keep their own.
    address public guardSigner;
    bool public roundsPaused;

    uint256 public roundCount;
    mapping(uint256 => Round) internal _rounds;
    mapping(uint256 => Attempt[]) internal _attempts;
    /// @notice The only key whose verdict can pay this round. Copied from `guardSigner` when the
    ///         round opens and never changed afterwards.
    mapping(uint256 => address) public roundSigner;
    mapping(uint256 => mapping(address => uint32)) public paidAttempts; // per round, per attacker

    /// @dev Stores (UTC day index + 1) of the last free attempt, so 0 means "never".
    mapping(address => uint256) internal _lastFreeDay;

    uint256 public reserve; // can only seed rounds
    uint256 public opsBalance; // running-cost share, withdrawable by owner

    // Public tester record
    mapping(address => uint256) public attemptsBy;
    mapping(address => uint256) public breaksBy;

    // ------------------------------------------------------------ events
    event RoundOpened(
        uint256 indexed roundId,
        uint8 level,
        uint64 startTime,
        uint64 endTime,
        uint256 baseFee,
        bool paidEnabled,
        bytes32 guardCommit,
        uint256 seed
    );
    event Attempted(
        uint256 indexed roundId,
        uint256 indexed attemptId,
        address indexed attacker,
        bytes32 messageHash,
        uint256 fee
    );
    event GuardBroken(uint256 indexed roundId, uint256 indexed attemptId, address indexed attacker, uint256 pot);
    event RoundRolledOver(uint256 indexed roundId, uint256 toReserve);
    event GuardRevealed(uint256 indexed roundId, bytes32 salt, bytes instructions);
    event OpsWithdrawn(address indexed to, uint256 amount);
    event GuardSignerChanged(address signer);
    event RoundSignerFixed(uint256 indexed roundId, address signer);
    event RoundsPaused(bool paused);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    // ------------------------------------------------------------ errors
    error NotOwner();
    error BadParams();
    error RoundsArePaused();
    error RoundNotLive();
    error RoundStillLive();
    error RoundClosed();
    error NotAgentIdHolder();
    error OperatorCannotAttack();
    error PaidAttemptsOff();
    error FeeAboveMax(uint256 fee);
    error NoSuchAttempt();
    error BadVerdict();
    error TooLateToSettle();
    error CommitMismatch();
    error InsufficientBalance();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address agentId_, address token_, address guardSigner_) EIP712("Turncoat", "1") {
        if (agentId_ == address(0) || token_ == address(0) || guardSigner_ == address(0)) revert BadParams();
        agentId = IAgentID(agentId_);
        token = IERC20(token_);
        guardSigner = guardSigner_;
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
        emit GuardSignerChanged(guardSigner_);
    }

    // ------------------------------------------------------------ rounds (owner)

    /// @notice Open a round. The seed comes from the caller (exact transferFrom) and/or the reserve.
    /// @param guardCommit keccak256(abi.encodePacked(salt, instructions)) of the guard's instructions.
    function openRound(
        uint8 level,
        uint64 duration,
        uint96 baseFee,
        bool paidEnabled,
        bytes32 guardCommit,
        uint256 seedFromOwner,
        uint256 seedFromReserve
    ) external onlyOwner nonReentrant returns (uint256 roundId) {
        if (roundsPaused) revert RoundsArePaused();
        if (
            level == 0 || duration < MIN_DURATION || duration > MAX_DURATION || guardCommit == bytes32(0)
                || (paidEnabled && baseFee == 0)
        ) revert BadParams();
        if (seedFromReserve > reserve) revert InsufficientBalance();

        if (seedFromOwner > 0) {
            uint256 before = token.balanceOf(address(this));
            token.safeTransferFrom(msg.sender, address(this), seedFromOwner);
            if (token.balanceOf(address(this)) - before != seedFromOwner) revert BadParams();
        }
        reserve -= seedFromReserve;

        roundId = ++roundCount;
        Round storage r = _rounds[roundId];
        r.level = level;
        r.paidEnabled = paidEnabled;
        r.startTime = uint64(block.timestamp);
        r.endTime = uint64(block.timestamp) + duration;
        r.baseFee = baseFee;
        r.guardCommit = guardCommit;
        r.pot = seedFromOwner + seedFromReserve;
        roundSigner[roundId] = guardSigner;

        emit RoundSignerFixed(roundId, guardSigner);
        emit RoundOpened(roundId, level, r.startTime, r.endTime, baseFee, paidEnabled, guardCommit, r.pot);
    }

    // ------------------------------------------------------------ attackers

    /// @notice Record one attempt against a round's guard. The message text goes to the guard
    ///         service off-chain; only its hash is stored here so it can never be changed later.
    ///         Uses the caller's free daily attempt if it is unused, otherwise charges the paid fee.
    /// @param maxFee The most the caller agrees to pay. Pass 0 to only ever use a free attempt.
    function attempt(uint256 roundId, bytes32 messageHash, uint256 maxFee)
        external
        nonReentrant
        returns (uint256 attemptId)
    {
        Round storage r = _rounds[roundId];
        if (r.startTime == 0 || r.closed || block.timestamp > r.endTime) revert RoundNotLive();
        if (msg.sender == owner || msg.sender == roundSigner[roundId] || msg.sender == guardSigner) {
            revert OperatorCannotAttack();
        }
        if (agentId.balanceOf(msg.sender) == 0) revert NotAgentIdHolder();
        if (messageHash == bytes32(0)) revert BadParams();

        uint256 fee;
        uint256 today = block.timestamp / 1 days + 1;
        if (_lastFreeDay[msg.sender] != today) {
            _lastFreeDay[msg.sender] = today;
        } else {
            if (!r.paidEnabled) revert PaidAttemptsOff();
            fee = _fee(r.baseFee, paidAttempts[roundId][msg.sender]);
            if (fee > maxFee) revert FeeAboveMax(fee);
            paidAttempts[roundId][msg.sender] += 1;

            uint256 before = token.balanceOf(address(this));
            token.safeTransferFrom(msg.sender, address(this), fee);
            if (token.balanceOf(address(this)) - before != fee) revert BadParams();

            uint256 toPot = (fee * POT_BPS) / 10000;
            uint256 toReserve = (fee * RESERVE_BPS) / 10000;
            r.pot += toPot;
            reserve += toReserve;
            opsBalance += fee - toPot - toReserve;
        }

        attemptId = _attempts[roundId].length;
        _attempts[roundId].push(Attempt(msg.sender, fee > 0, uint64(block.timestamp), messageHash));
        r.attemptCount += 1;
        attemptsBy[msg.sender] += 1;

        emit Attempted(roundId, attemptId, msg.sender, messageHash, fee);
    }

    /// @notice Pay the pot to the attacker whose attempt broke the guard. Anyone can submit the
    ///         signed verdict. It must be signed by the signer fixed when this round opened;
    ///         changing `guardSigner` later has no effect here. The first valid verdict settles.
    function settle(uint256 roundId, uint256 attemptId, bytes calldata signature) external nonReentrant {
        Round storage r = _rounds[roundId];
        if (r.startTime == 0 || r.closed) revert RoundClosed();
        if (block.timestamp > uint256(r.endTime) + SETTLE_GRACE) revert TooLateToSettle();
        if (attemptId >= _attempts[roundId].length) revert NoSuchAttempt();

        address attacker = _attempts[roundId][attemptId].attacker;
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(VERDICT_TYPEHASH, roundId, attemptId, attacker)));
        if (ECDSA.recover(digest, signature) != roundSigner[roundId]) revert BadVerdict();

        uint256 pot = r.pot;
        r.pot = 0;
        r.closed = true;
        r.winner = attacker;
        r.winningAttempt = uint32(attemptId);
        breaksBy[attacker] += 1;

        if (pot > 0) token.safeTransfer(attacker, pot);
        emit GuardBroken(roundId, attemptId, attacker, pot);
    }

    /// @notice If nobody broke the guard, move the pot into the reserve so it seeds a later round.
    ///         Anyone can call this once the settle window has passed.
    function rollOver(uint256 roundId) external {
        Round storage r = _rounds[roundId];
        if (r.startTime == 0 || r.closed) revert RoundClosed();
        if (block.timestamp <= uint256(r.endTime) + SETTLE_GRACE) revert RoundStillLive();
        uint256 pot = r.pot;
        r.pot = 0;
        r.closed = true;
        reserve += pot;
        emit RoundRolledOver(roundId, pot);
    }

    /// @notice Publish the guard's instructions once the round is over. Reverts unless they match
    ///         the hash committed when the round opened.
    function revealGuard(uint256 roundId, bytes32 salt, bytes calldata instructions) external {
        Round storage r = _rounds[roundId];
        if (r.startTime == 0) revert BadParams();
        if (!r.closed && block.timestamp <= r.endTime) revert RoundStillLive();
        if (keccak256(abi.encodePacked(salt, instructions)) != r.guardCommit) revert CommitMismatch();
        emit GuardRevealed(roundId, salt, instructions);
    }

    // ------------------------------------------------------------ views

    function getRound(uint256 roundId) external view returns (Round memory) {
        return _rounds[roundId];
    }

    function getAttempt(uint256 roundId, uint256 attemptId) external view returns (Attempt memory) {
        if (attemptId >= _attempts[roundId].length) revert NoSuchAttempt();
        return _attempts[roundId][attemptId];
    }

    function isLive(uint256 roundId) external view returns (bool) {
        Round storage r = _rounds[roundId];
        return r.startTime != 0 && !r.closed && block.timestamp <= r.endTime;
    }

    function freeAttemptAvailable(address attacker) public view returns (bool) {
        return _lastFreeDay[attacker] != block.timestamp / 1 days + 1;
    }

    /// @notice What the next attempt would cost this attacker in this round (0 if their free attempt is unused).
    function nextFee(uint256 roundId, address attacker) external view returns (uint256) {
        if (freeAttemptAvailable(attacker)) return 0;
        return _fee(_rounds[roundId].baseFee, paidAttempts[roundId][attacker]);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _fee(uint256 baseFee, uint256 paidSoFar) internal pure returns (uint256) {
        uint256 bps = 10000 + FEE_STEP_BPS * paidSoFar;
        if (bps > MAX_FEE_BPS) bps = MAX_FEE_BPS;
        return (baseFee * bps) / 10000;
    }

    // ------------------------------------------------------------ owner (limited, documented)

    function withdrawOps(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert BadParams();
        if (amount > opsBalance) revert InsufficientBalance();
        opsBalance -= amount;
        token.safeTransfer(to, amount);
        emit OpsWithdrawn(to, amount);
    }

    /// @notice Sets the signer for rounds opened after this call. Rounds already open are not
    ///         affected: each keeps the signer it opened with until it is paid or rolls over.
    function setGuardSigner(address signer) external onlyOwner {
        if (signer == address(0)) revert BadParams();
        guardSigner = signer;
        emit GuardSignerChanged(signer);
    }

    /// @notice Stops NEW rounds from opening. Live rounds, attempts and payouts are unaffected.
    function setRoundsPaused(bool paused) external onlyOwner {
        roundsPaused = paused;
        emit RoundsPaused(paused);
    }

    function transferOwnership(address to) external onlyOwner {
        pendingOwner = to;
        emit OwnershipTransferStarted(owner, to);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }
}
