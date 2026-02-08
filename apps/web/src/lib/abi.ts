import { parseAbi } from "viem";

export const ghBountiesAbi = parseAbi([
  "function repos(bytes32 repoHash) view returns (address maintainer, bool exists)",
  "function bounties(bytes32 bountyId) view returns (bytes32 repoHash, uint256 issueNumber, uint8 status, uint64 createdAt, string metadataURI)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function payoutNonces(bytes32 bountyId) view returns (uint256)",
  "function refundNonces(bytes32 bountyId) view returns (uint256)",
  "function registerRepo(bytes32 repoHash)",
  "function createBounty(bytes32 repoHash, uint256 issueNumber, string metadataURI) returns (bytes32)",
  "function fundBountyETH(bytes32 bountyId, uint64 lockDurationSeconds) payable",
  "function fundBountyToken(bytes32 bountyId, address token, uint256 amount, uint64 lockDurationSeconds)",
  "function submitClaim(bytes32 bountyId, string claimMetadataURI) returns (uint256)",
  "function submitClaimWithAuthorization(bytes32 bountyId, string claimMetadataURI, uint256 nonce, uint256 deadline, bytes signature) returns (uint256)",
  "function payout(bytes32 bountyId, address token, address recipient, uint256 amount)",
  "function payoutWithAuthorization(bytes32 bountyId, address token, address recipient, uint256 amount, uint256 nonce, uint256 deadline, bytes signature)",
  "function refund(bytes32 bountyId, address token, address funder, uint256 amount)",
  "function refundWithAuthorization(bytes32 bountyId, address token, address funder, uint256 amount, uint256 nonce, uint256 deadline, bytes signature)",
  "function daoPayout(bytes32 bountyId, address token, address recipient, uint256 amount)",
  "function daoRefund(bytes32 bountyId, address token, address funder, uint256 amount)",
  "function funderPayout(bytes32 bountyId, address token, address recipient, uint256 amount)",
  "function withdrawAfterTimeout(bytes32 bountyId, address token)",
  "function setStatus(bytes32 bountyId, uint8 status)",
  "function computeBountyId(bytes32 repoHash, uint256 issueNumber) view returns (bytes32)",
  "function getTotals(bytes32 bountyId, address token) view returns (uint256 escrowed, uint256 funded, uint256 paid)",
  "function getContribution(bytes32 bountyId, address token, address funder) view returns (uint256 amount, uint64 lockedUntil)",

  "event RepoRegistered(bytes32 indexed repoHash, address indexed maintainer)",
  "event RepoMaintainerChanged(bytes32 indexed repoHash, address indexed oldMaintainer, address indexed newMaintainer)",
  "event BountyCreated(bytes32 indexed bountyId, bytes32 indexed repoHash, uint256 indexed issueNumber, string metadataURI)",
  "event BountyFunded(bytes32 indexed bountyId, address indexed token, address indexed funder, uint256 amount, uint64 lockedUntil)",
  "event ClaimSubmitted(bytes32 indexed bountyId, uint256 indexed claimId, address indexed claimer, string metadataURI)",
  "event StatusChanged(bytes32 indexed bountyId, uint8 status)",
  "event PaidOut(bytes32 indexed bountyId, address indexed token, address indexed recipient, uint256 amount)",
  "event Refunded(bytes32 indexed bountyId, address indexed token, address indexed funder, uint256 amount)"
]);

export const erc20Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
]);

export const gatewayWalletAbi = parseAbi([
  "function deposit(address token, uint256 value)"
]);
