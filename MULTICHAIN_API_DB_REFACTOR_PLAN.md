# Multi-chain API + DB Refactor Plan (Single URL, Network Switch)

Goal: run **one API + one DB** that can index and serve **multiple (chainId, contractAddress)** pairs (e.g. Ethereum mainnet + Sepolia), so the web UI can switch networks without changing origins.

This is a larger follow-up to the current recommended approach (separate stacks per network).

## 1) Configuration model

### 1.1 Networks registry

Introduce a multi-network config while keeping the current single-network env vars as a fallback.

- New env var (preferred):
  - `NETWORKS_JSON='[{"chainId":1,"contractAddress":"0x…","rpcUrls":["…"]},{"chainId":11155111,"contractAddress":"0x…","rpcUrls":["…"]}]'`
- Fallback (current behavior):
  - `CHAIN_ID`, `CONTRACT_ADDRESS`, `RPC_URL` / `RPC_URLS_ETHEREUM_*`

At boot, parse `NETWORKS_JSON` into an in-memory registry:

- Key: `${chainId}:${contractAddress.toLowerCase()}`
- Value: `{ chainId, contractAddress, rpcUrls, rpcTransport, publicClient }`

### 1.2 Network discovery endpoint

Add:

- `GET /networks` → configured networks (plus optional contract metadata via `eth_call`, e.g. `payoutAuthorizer`, `dao`, `daoDelaySeconds`).

## 2) Prisma schema changes (avoid cross-chain collisions)

### 2.1 Why this is required

On-chain `bountyId` is derived from **only** `(repoHash, issueNumber)`.
That means the **same GitHub issue** produces the **same `bountyId`** on mainnet and sepolia.

The current schema has `Bounty.bountyId @unique`, so a single DB cannot store both networks.

### 2.2 Preferred schema direction (normalize around `Bounty.id`)

- Keep `Bounty.id` as the primary key.
- Change `Bounty` uniqueness:
  - Remove `bountyId @unique`
  - Add `@@unique([bountyId, chainId, contractAddress])`
- For each child table currently referencing `bountyId` (`BountyAsset`, `Funding`, `Claim`, `Payout`, `Refund`, `LinkedPullRequest`):
  - Add `bountyDbId String`
  - Change relations to reference `Bounty.id` via `bountyDbId`
  - Keep `bountyId` as a scalar only if useful for debugging / API payloads

### 2.3 Migration plan (SQLite-friendly)

1. Migration A
   - Drop unique constraint on `Bounty.bountyId`
   - Add composite unique constraint on `(bountyId, chainId, contractAddress)`
   - Add `bountyDbId` (nullable) to child tables
2. Backfill
   - Populate `bountyDbId` in child rows by joining on the current unique `bountyId`
3. Migration B
   - Make `bountyDbId` NOT NULL
   - Add indexes on `bountyDbId` + common query fields
   - Update Prisma relations to use `bountyDbId`
4. Optional cleanup
   - Drop redundant child-table `bountyId` columns if no longer needed

## 3) Indexer changes (run one indexer per network)

- Start one `startIndexer()` per configured network (each with its own RPC transport, chainId, contractAddress).
- `IndexerState` can remain keyed by `(chainId, contractAddress)` (already modeled that way).

Write path updates:

- Upsert `Bounty` by `(bountyId, chainId, contractAddress)`.
- When handling events for fundings/claims/payouts/refunds/linked PRs:
  - Resolve the corresponding `Bounty.id` and store it as `bountyDbId`.

## 4) Read endpoints (explicit network filtering)

Update:

- `GET /issues`
- `GET /bounties`

to accept network filters:

- Query params: `chainId`, `contractAddress`
- Behavior when omitted (pick one, document it):
  1. Return all networks (with network fields included), or
  2. Require network parameters in production (safer), or
  3. Default to a configured “primary network”

Ambiguity handling:

- If `bountyId` is provided without `chainId/contractAddress` and it matches multiple networks, return `409` (or `400`) with an “ambiguous bountyId” error.

## 5) Auth/signature endpoints (network-aware EIP-712)

Endpoints:

- `POST /claim-auth`
- `POST /payout-auth`
- `POST /refund-auth`

must sign typed data with the correct domain:

- `domain.chainId = chainId`
- `domain.verifyingContract = contractAddress`

Request shape requirements:

- Require `{ chainId, contractAddress }` in the request body, OR infer it from DB only if the request is unambiguous.

On-chain reads must use the network-specific `publicClient`.

## 6) Web app follow-on (single origin, runtime network toggle)

- Fetch `GET /networks` at runtime; populate a network selector.
- Persist selection in `localStorage` (or cookie).
- Include selected `chainId/contractAddress` in API calls (query params or a header like `X-GHB-NETWORK`).

Wallet UX:

- Before funding/claim/payout, ensure the injected wallet is on the selected chain (prompt `wallet_switchEthereumChain`).
- Use the selected network’s contract address for writes.
- Block actions when wallet chain != selected chain to prevent mis-funding.

## 7) Rollout strategy

1. Add multi-network config + `GET /networks` (no schema change yet).
2. Apply DB migrations + backfill.
3. Run multi-indexer in production, verify indexing for both networks.
4. Make web network selection runtime-configurable and switch API calls to include network selection.
5. Decide final default behavior for missing network selection (strict vs “all networks”).

