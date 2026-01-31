// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title GHBounties
/// @notice ETH + ERC20 escrow per (repo, issue). Repo maintainer approves payouts/refunds.
///         Funders can withdraw *their* remaining contribution after their chosen lock expires,
///         but only if no payout has occurred for the bounty.
contract GHBounties {
    enum BountyStatus {
        OPEN,
        IMPLEMENTED,
        CLOSED
    }

    struct Repo {
        address maintainer;
        bool exists;
    }

    struct Bounty {
        bytes32 repoHash;
        uint256 issueNumber;
        BountyStatus status;
        uint64 createdAt;
        string metadataURI; // optional (e.g. issue URL)
    }

    struct Claim {
        address claimer;
        uint64 createdAt;
        string metadataURI; // e.g. PR URL
    }

    // address(0) represents native ETH.
    address public constant NATIVE_TOKEN = address(0);

    error RepoAlreadyRegistered();
    error RepoNotRegistered();
    error NotMaintainer();
    error BountyAlreadyExists();
    error BountyNotFound();
    error BountyNotOpen();
    error InvalidAmount();
    error InvalidToken();
    error RefundNotAvailable();
    error NothingToRefund();

    event RepoRegistered(bytes32 indexed repoHash, address indexed maintainer);
    event RepoMaintainerChanged(bytes32 indexed repoHash, address indexed oldMaintainer, address indexed newMaintainer);

    event BountyCreated(bytes32 indexed bountyId, bytes32 indexed repoHash, uint256 indexed issueNumber, string metadataURI);
    event BountyFunded(
        bytes32 indexed bountyId,
        address indexed token,
        address indexed funder,
        uint256 amount,
        uint64 lockedUntil
    );
    event ClaimSubmitted(bytes32 indexed bountyId, uint256 indexed claimId, address indexed claimer, string metadataURI);
    event StatusChanged(bytes32 indexed bountyId, BountyStatus status);
    event PaidOut(bytes32 indexed bountyId, address indexed token, address indexed recipient, uint256 amount);
    event Refunded(bytes32 indexed bountyId, address indexed token, address indexed funder, uint256 amount);

    mapping(bytes32 repoHash => Repo) public repos;
    mapping(bytes32 bountyId => Bounty) public bounties;

    // bountyId => token => escrow totals
    mapping(bytes32 bountyId => mapping(address token => uint256)) public escrowed;
    mapping(bytes32 bountyId => mapping(address token => uint256)) public totalFunded;
    mapping(bytes32 bountyId => mapping(address token => uint256)) public totalPaid;

    // Once any payout occurs (in any token), timeout withdrawals are disabled for this bounty.
    mapping(bytes32 bountyId => bool) public anyPayoutOccurred;

    // bountyId => token => funder => contributed (net of refunds/withdrawals)
    mapping(bytes32 bountyId => mapping(address token => mapping(address funder => uint256))) public contributions;
    // bountyId => token => funder => unix timestamp until which funds are not withdrawable
    mapping(bytes32 bountyId => mapping(address token => mapping(address funder => uint64))) public lockedUntil;

    // bountyId => claimId => Claim
    mapping(bytes32 bountyId => mapping(uint256 claimId => Claim claim)) public claims;
    mapping(bytes32 bountyId => uint256 nextClaimId) public nextClaimIds;

    uint64 public immutable defaultLockDuration; // seconds (e.g. 7 days)

    constructor(uint64 _defaultLockDuration) {
        defaultLockDuration = _defaultLockDuration;
    }

    // -------- Repo management --------

    /// @notice Register a repoHash with msg.sender as maintainer (opt-in).
    /// @dev GitHub admin verification is expected off-chain (GitHub App / OAuth).
    function registerRepo(bytes32 repoHash) external {
        Repo storage r = repos[repoHash];
        if (r.exists) revert RepoAlreadyRegistered();
        repos[repoHash] = Repo({maintainer: msg.sender, exists: true});
        emit RepoRegistered(repoHash, msg.sender);
    }

    function changeMaintainer(bytes32 repoHash, address newMaintainer) external {
        Repo storage r = repos[repoHash];
        if (!r.exists) revert RepoNotRegistered();
        if (msg.sender != r.maintainer) revert NotMaintainer();
        address old = r.maintainer;
        r.maintainer = newMaintainer;
        emit RepoMaintainerChanged(repoHash, old, newMaintainer);
    }

    // -------- Bounties --------

    function computeBountyId(bytes32 repoHash, uint256 issueNumber) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(repoHash, issueNumber));
    }

    function createBounty(bytes32 repoHash, uint256 issueNumber, string calldata metadataURI) external returns (bytes32) {
        Repo storage r = repos[repoHash];
        if (!r.exists) revert RepoNotRegistered();

        bytes32 bountyId = computeBountyId(repoHash, issueNumber);
        Bounty storage b = bounties[bountyId];
        if (b.createdAt != 0) revert BountyAlreadyExists();

        b.repoHash = repoHash;
        b.issueNumber = issueNumber;
        b.status = BountyStatus.OPEN;
        b.createdAt = uint64(block.timestamp);
        b.metadataURI = metadataURI;

        emit BountyCreated(bountyId, repoHash, issueNumber, metadataURI);
        return bountyId;
    }

    // -------- Funding --------

    /// @notice Fund a bounty with ETH and optionally set/extend your lock.
    /// @param lockDurationSeconds If 0, uses defaultLockDuration. Otherwise uses the provided duration.
    function fundBountyETH(bytes32 bountyId, uint64 lockDurationSeconds) external payable {
        _fund(bountyId, NATIVE_TOKEN, msg.value, lockDurationSeconds);
    }

    /// @notice Fund a bounty with an ERC20 token. Requires prior approval.
    /// @param token ERC20 address (must be non-zero)
    /// @param amount Token amount (in token decimals, e.g. USDC 6)
    /// @param lockDurationSeconds If 0, uses defaultLockDuration. Otherwise uses the provided duration.
    function fundBountyToken(bytes32 bountyId, address token, uint256 amount, uint64 lockDurationSeconds) external {
        if (token == NATIVE_TOKEN) revert InvalidToken();
        if (amount == 0) revert InvalidAmount();

        Bounty storage b = bounties[bountyId];
        if (b.createdAt == 0) revert BountyNotFound();
        if (b.status != BountyStatus.OPEN) revert BountyNotOpen();

        // Pull tokens from funder.
        bool ok = IERC20(token).transferFrom(msg.sender, address(this), amount);
        require(ok, "TOKEN_TRANSFER_FROM_FAILED");

        _updateContributionAndLock(bountyId, token, amount, lockDurationSeconds);
        emit BountyFunded(bountyId, token, msg.sender, amount, lockedUntil[bountyId][token][msg.sender]);
    }

    function _fund(bytes32 bountyId, address token, uint256 amount, uint64 lockDurationSeconds) internal {
        if (amount == 0) revert InvalidAmount();

        Bounty storage b = bounties[bountyId];
        if (b.createdAt == 0) revert BountyNotFound();
        if (b.status != BountyStatus.OPEN) revert BountyNotOpen();

        _updateContributionAndLock(bountyId, token, amount, lockDurationSeconds);
        emit BountyFunded(bountyId, token, msg.sender, amount, lockedUntil[bountyId][token][msg.sender]);
    }

    function _updateContributionAndLock(bytes32 bountyId, address token, uint256 amount, uint64 lockDurationSeconds) internal {
        escrowed[bountyId][token] += amount;
        totalFunded[bountyId][token] += amount;
        contributions[bountyId][token][msg.sender] += amount;

        uint64 dur = lockDurationSeconds == 0 ? defaultLockDuration : lockDurationSeconds;
        uint64 until = uint64(block.timestamp) + dur;
        uint64 prev = lockedUntil[bountyId][token][msg.sender];
        if (until > prev) lockedUntil[bountyId][token][msg.sender] = until;
    }

    // -------- Claims --------

    function submitClaim(bytes32 bountyId, string calldata claimMetadataURI) external returns (uint256 claimId) {
        Bounty storage b = bounties[bountyId];
        if (b.createdAt == 0) revert BountyNotFound();

        claimId = nextClaimIds[bountyId]++;
        claims[bountyId][claimId] =
            Claim({claimer: msg.sender, createdAt: uint64(block.timestamp), metadataURI: claimMetadataURI});
        emit ClaimSubmitted(bountyId, claimId, msg.sender, claimMetadataURI);
    }

    // -------- Maintainer controls --------

    function setStatus(bytes32 bountyId, BountyStatus status) external {
        Bounty storage b = bounties[bountyId];
        if (b.createdAt == 0) revert BountyNotFound();

        Repo storage r = repos[b.repoHash];
        if (msg.sender != r.maintainer) revert NotMaintainer();

        b.status = status;
        emit StatusChanged(bountyId, status);
    }

    function payout(bytes32 bountyId, address token, address payable recipient, uint256 amount) external {
        Bounty storage b = bounties[bountyId];
        if (b.createdAt == 0) revert BountyNotFound();

        Repo storage r = repos[b.repoHash];
        if (msg.sender != r.maintainer) revert NotMaintainer();
        if (b.status == BountyStatus.CLOSED) revert BountyNotOpen();
        if (amount == 0 || amount > escrowed[bountyId][token]) revert InvalidAmount();

        escrowed[bountyId][token] -= amount;
        totalPaid[bountyId][token] += amount;
        anyPayoutOccurred[bountyId] = true;

        if (token == NATIVE_TOKEN) {
            (bool ok, ) = recipient.call{value: amount}("");
            require(ok, "ETH_TRANSFER_FAILED");
        } else {
            bool ok = IERC20(token).transfer(recipient, amount);
            require(ok, "TOKEN_TRANSFER_FAILED");
        }

        emit PaidOut(bountyId, token, recipient, amount);
    }

    /// @notice Maintainer-driven refund (any time, any amount up to contribution).
    function refund(bytes32 bountyId, address token, address payable funder, uint256 amount) external {
        Bounty storage b = bounties[bountyId];
        if (b.createdAt == 0) revert BountyNotFound();

        Repo storage r = repos[b.repoHash];
        if (msg.sender != r.maintainer) revert NotMaintainer();

        uint256 contributed = contributions[bountyId][token][funder];
        if (amount == 0 || amount > contributed) revert InvalidAmount();
        if (amount > escrowed[bountyId][token]) revert InvalidAmount();

        contributions[bountyId][token][funder] = contributed - amount;
        escrowed[bountyId][token] -= amount;

        if (token == NATIVE_TOKEN) {
            (bool ok, ) = funder.call{value: amount}("");
            require(ok, "ETH_TRANSFER_FAILED");
        } else {
            bool ok = IERC20(token).transfer(funder, amount);
            require(ok, "TOKEN_TRANSFER_FAILED");
        }

        emit Refunded(bountyId, token, funder, amount);
    }

    // -------- Timeout withdrawal --------

    /// @notice Funder can withdraw their full remaining contribution after their lock expires,
    ///         only if no payout has occurred for the bounty.
    function withdrawAfterTimeout(bytes32 bountyId, address token) external {
        Bounty storage b = bounties[bountyId];
        if (b.createdAt == 0) revert BountyNotFound();
        if (anyPayoutOccurred[bountyId]) revert RefundNotAvailable();

        uint64 until = lockedUntil[bountyId][token][msg.sender];
        if (block.timestamp < until) revert RefundNotAvailable();

        uint256 amt = contributions[bountyId][token][msg.sender];
        if (amt == 0) revert NothingToRefund();
        if (amt > escrowed[bountyId][token]) revert InvalidAmount();

        contributions[bountyId][token][msg.sender] = 0;
        escrowed[bountyId][token] -= amt;

        if (token == NATIVE_TOKEN) {
            (bool ok, ) = payable(msg.sender).call{value: amt}("");
            require(ok, "ETH_TRANSFER_FAILED");
        } else {
            bool ok = IERC20(token).transfer(msg.sender, amt);
            require(ok, "TOKEN_TRANSFER_FAILED");
        }

        emit Refunded(bountyId, token, msg.sender, amt);
    }

    // -------- Convenience views --------

    function getTotals(bytes32 bountyId, address token) external view returns (uint256 _escrowed, uint256 _funded, uint256 _paid) {
        return (escrowed[bountyId][token], totalFunded[bountyId][token], totalPaid[bountyId][token]);
    }

    function getContribution(bytes32 bountyId, address token, address funder) external view returns (uint256 amount, uint64 _lockedUntil) {
        return (contributions[bountyId][token][funder], lockedUntil[bountyId][token][funder]);
    }
}

