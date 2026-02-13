# Issue #22 Implementation Plan: Serverless bounty authorization via zkTLS proofs

## Objective
Implement issue [#22](https://github.com/seichris/clankergigs/issues/22) by replacing backend-signed claim/payout/refund authorization with optional zkTLS-backed authorization while preserving legacy API-signed flow.

## Non-goals for this stage
- Removing existing `/claim-auth`, `/payout-auth`, `/refund-auth` endpoints.
- Removing current funder-only fallback functions (`funderPayout`, `withdrawAfterTimeout`).

## Success criteria
- PR authors can claim a bounty without API signature dependency via `submitClaimWithZkTls`.
- Repo admins can authorize payouts/refunds via API-independent evidence when they choose.
- All old flows remain available as fallback.
- Contract and API reject replay and repo mismatch attempts.

## Work plan

### 1) Contract: introduce verifier abstraction and proof replay guards
File: `contracts/src/GHBounties.sol`

- Add verifier interfaces and configurable verifier storage:
  - `IVerifier` interface with proof verification.
  - `claimZkTlsVerifier`, `payoutZkTlsVerifier`, `refundZkTlsVerifier` addresses.
- Add typed nonces/nullifiers for on-chain proofs:
  - e.g., `mapping(bytes32 => bool) proofUsed;` keyed by `keccak256(action, bountyId, token, actor, target, amountWei, uri, nonce)`.
- Add action-specific payload hashes:
  - `claimHash = keccak256(abi.encodePacked("ghb-claim-v1", chainId, address(this), bountyId, claimer, claimMetadataURI, deadline, nonce))`
  - `payoutHash` and `refundHash` similarly include exact tuple fields.
- Add governance setter functions for verifier addresses and pause toggles where needed.
- Add `bytes32` domain separators or explicit `actionId` strings to prevent cross-contract cross-chain replay.

### 2) Contract: add zkTLS claim path
File: `contracts/src/GHBounties.sol`

- Add external function:
  - `submitClaimWithZkTLS(uint256 bountyId, string calldata claimMetadataURI, uint256 nonce, uint256 deadline, bytes calldata proof, bytes32[] calldata publicSignals)`
- Validation steps:
  - enforce `block.timestamp <= deadline`.
  - verify bounty is claimable and not already claimed.
  - validate proof against verifier and action payload.
  - parse/validate issue/PR repo binding between bounty metadata and PR URL.
  - enforce repo path consistency and proof nonce consumption.
- Mark proof/hash as consumed and store claim record.
- Call existing payout state transitions (so payouts can use old or new auth path).

### 3) Contract: optional admin payout/refund zkTLS paths
File: `contracts/src/GHBounties.sol`

- Add external functions:
  - `submitPayoutWithZkTLS(...)`
  - `submitRefundWithZkTLS(...)`
- Shared validation:
  - proof must authenticate `repoAdmin` role and tuple fields (`bountyId`, `token`, recipient/funder, amountWei, deadline, nonce).
  - enforce one-time proof/nullifier consumption.
  - preserve existing `payoutWithAuthorization`/`refundWithAuthorization` behavior as fallback.

### 4) Shared utilities: canonical GitHub URI parsing
Files:
- `contracts/src/GHBounties.sol` (or helper library if needed)
- `packages/shared/src/index.ts`

- Export consistent canonicalization for issue/PR URLs:
  - normalizing `https://github.com/<owner>/<repo>/...`
  - extracting `<owner>`, `<repo>`, and PR number in canonical string form.
- Ensure on-chain and off-chain checks use the same canonical representation.

### 5) API: keep existing endpoints and add capability metadata
Files:
- `apps/api/src/index.ts`
- `apps/api/src/indexer/github/*` as needed

- Leave API endpoints in place for backward compatibility.
- Add optional helper endpoint (v2 metadata)
  - returns digest fields needed by clients before proof submission if useful.
  - no signer is required for zkTLS submit paths.

### 6) Frontend: add proof submission path
Files:
- `apps/web/src/**/*`
- `apps/web-sui/src/**/*` (if scope expanded)

- Add a claim action button/flow that can use zkTLS mode.
- Add payout/refund admin path controls behind feature flag.
- Show verifier status and proof nonce/deadline UX warnings.

### 7) Agent scripts and docs
Files:
- `scripts-for-ai-agents/`
- `README.md`
- `implementation.md`

- Add scripts for submitting proof payloads once generated.
- Document endpoint and contract method changes for mainnet and Sepolia.
- Add operational notes for key rotation and emergency fallback to legacy API flow.

## Acceptance test checklist

- Unit/integration tests for:
  - proof replay rejection
  - repo mismatch rejection
  - expired proof rejection
  - successful claim via zkTLS without API signature
  - successful payout/refund via zkTLS
  - old API-signed claim/payout/refund still accepted
- Indexing/CLI path still supports legacy `--claim-auth` and new zkTLS helper output.

## Deployment/migration plan

- Deploy contract upgrade behind governance (if upgradeable proxy) or coordinated release if immutable.
- Keep legacy env vars and APIs untouched in the release.
- Monitor failed proof events and provide fallback switch if external verifier unavailable.

## Why this satisfies issue #22

It enables a backend-independent claim and admin authorization path with explicit cryptographic proof of GitHub state, while preserving existing API-signer functionality as a safety fallback.
