# Issue #22 Implementation Plan: Serverless claim/payout via zkTLS proofs

## Goal
Deliver a serverless path for bounty operations by replacing backend signer dependency for claim and optionally payout/refund flows with on-chain verifiable zkTLS proofs of GitHub state. Maintain the existing backend-authorized path as a fallback.

## Scope
- Bounty system: `seichris/clankergigs` monorepo
- Issue to solve: `#22` in this repo
- Targets:
  - Serverless claim submission (must-have)
  - Optional serverless payout and refund authorization (phase 2)

## Current behavior to change
- Claim/payout authorization currently relies on API-generated EIP-712 signatures (`POST /claim-auth`, `/payout-auth`, `/refund-auth`).
- Contract side (`GHBounties.sol`) requires signatures and checks with `ECDSA`/replay-protected nonces in `_verifyClaimAuth`, `_verifyPayoutAuth`, `_verifyRefundAuth`.

## Proposed design

### 1) Identity binding registry (on-chain)
Add a new immutable proof-friendly identity registry:
- `githubLoginBindingRoot[keccak256(login)] -> boundAddress` (or equivalent mapping with nonce/expiry)
- `login -> account owner key` can be updated by owner-controlled rotation flow (challenge+rebind)
- Binding must include:
  - GitHub login
  - target chain id and contract address
  - binding nonce
  - expiry timestamp
  - account address
- Signature/claim checks must enforce `msg.sender == boundAddress(bindingRoot)`.

### 2) Verifier abstraction
Create a pluggable on-chain verifier interface:
- `IVerifier` interface for proof + publicSignals verification
- Contract stores verifier per action (claim/payout/refund)
- Initially support one provider (Reclaim / Primus / BringID) behind a versioned verifier contract
- Action-specific proof domain to prevent replay across chains/apps:
  - `actionId = keccak256("ghb-claim-v1" || chainId || contract || bountyId || actor || claimUri)`

### 3) Claim flow v2 (`submitClaimWithZkTLSProof`)
- New user entrypoint in escrow:
  - `submitClaimWithZkTLSProof(bountyId, claimMetadataURI, proof, publicSignals, claimData)`
- Requirements enforced on-chain:
  - PR URL points to same repo as bounty metadata URI
  - PR author login resolves to bound address that matches `msg.sender`
  - nonce/hash binds to `bountyId + msg.sender + claimMetadataURI`
  - one-time claim per claimer/bounty via a replay key/bitmap or existing claim record
- Reuse existing payout gating rules (e.g. only first claimer wins, bounty lock/state checks).

### 4) Optional payout/refund flow v2
- Two approaches:
  1. Admin-proof payout/refund:
     - Proof from GitHub admin action (comment command / workflow approval artifact)
     - verifies `repo-admin(login)` and exact `(bountyId, token, recipient/funder, amount)` tuple
     - optional nullifier to prevent replay
  2. Fallback to existing backend DAO/authorizer path
- Keep old signer paths in place to avoid breaking existing clients.

### 5) Client/CLI flow
- Add `proof` mode to `apps/web` and/or agent scripts:
  - `ghb` CLI path for generating proof artifacts
  - PR authoring and payout admin flow remains in repo issue/PR UX where possible
- PR-authoring path in docs:
  - fork → bind GitHub login to wallet once → open PR with required URL → generate proof → call new contract method.

## Contract changes (high level)
- `contracts/src/GHBounties.sol`
  - Add storage for `githubLoginBindingRoot` + optional verifier addresses
  - Add one-time/nullifier tracking for zkTLS claims
  - Add new claim entrypoint and verifier call
  - Keep existing `_verifyClaimAuth` + `submitClaimWithAuthorization` unchanged
  - Add governance/admin controls for verifier upgrades and pause behavior

## API changes (high level)
- `apps/api/src/index.ts`
  - Maintain legacy endpoints for compatibility
  - Optionally add helper endpoint returning signed statement templates and verification params (chainId, contract, bountyId action digest)
  - Avoid being in critical claim path for new `v2` mode

## Security hardening
- Replay resistance:
  - Proof statements must include chain, contract, bountyId, claim URI, and claimant
  - Enforce one-time consumption by on-chain marker
- Data integrity:
  - Canonicalize repository + PR URI parsing
  - Reject non-match repo mismatch
  - Require proof freshness windows when provider supports timestamps
- Binding safety:
  - one binding per login by default, rotate with delay or explicit revoke semantics
  - optional proof that binding statement was hosted at controlled GitHub surface
- Upgrade safety:
  - verifier changes behind owner/admin governance with timelock on critical path if feasible

## Phased rollout
1. Phase A (claim first): add bindings + claim zkTLS verifier + dual-path contract support.
2. Phase B: add payout/refund zkTLS proof routes with strict tuple/amount checks.
3. Phase C: add UI/agent UX for proof generation and submission.
4. Phase D: on-chain tests and fuzzing, gas benchmarking, documentation, deployment notes.

## Acceptance mapping
- Claim without `/claim-auth`: covered by new `submitClaimWithZkTLSProof`.
- Correct author enforcement: bound GitHub login + PR author proof + msg.sender match.
- Replay resistance: proof/action tuple binding + consumed marker.
- Negative coverage:
  - non-author claim attempt fails at bound-address check
  - repo mismatch fails URI/repo binding checks
  - PR mismatch fails proof tuple check
- Backward compatibility: old API-signed path remains for existing clients.

## Files touched (initial)
- `contracts/src/GHBounties.sol`
- `apps/api/src/index.ts`
- `apps/web` or agent tooling (new zkTLS UX path)
- New docs in `implementation.md`

## Why this is correct for issue #22
It removes backend critical dependency for claims while preserving existing fallback flows and introduces explicit zkTLS proof semantics so GitHub identity and approval evidence are verified cryptographically instead of by a hot API signer.
