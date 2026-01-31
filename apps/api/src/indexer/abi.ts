import { parseAbi } from "viem";

export const ghBountiesAbi = parseAbi([
  "event RepoRegistered(bytes32 indexed repoHash, address indexed maintainer)",
  "event RepoMaintainerChanged(bytes32 indexed repoHash, address indexed oldMaintainer, address indexed newMaintainer)",
  "event BountyCreated(bytes32 indexed bountyId, bytes32 indexed repoHash, uint256 indexed issueNumber, string metadataURI)",
  "event BountyFunded(bytes32 indexed bountyId, address indexed token, address indexed funder, uint256 amount, uint64 lockedUntil)",
  "event ClaimSubmitted(bytes32 indexed bountyId, uint256 indexed claimId, address indexed claimer, string metadataURI)",
  "event StatusChanged(bytes32 indexed bountyId, uint8 status)",
  "event PaidOut(bytes32 indexed bountyId, address indexed token, address indexed recipient, uint256 amount)",
  "event Refunded(bytes32 indexed bountyId, address indexed token, address indexed funder, uint256 amount)"
]);
