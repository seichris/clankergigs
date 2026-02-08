# Sui Web Write Flows (Create/Fund/Claim/Payout) Implementation Plan 

Target: https://sui.clankergigs.com (repo: `apps/web-sui`)

Status today (Feb 8, 2026): `apps/web-sui` is a read-only viewer. The UI already supports Sui wallet connect via `@mysten/dapp-kit`, and `apps/api-sui` indexes on-chain events into a Sui-specific SQLite DB and serves `GET /issues` and `GET /bounties`.

This plan turns the Sui web into a write-capable dapp for:

- Create bounty (on-chain `create_bounty`)
- Fund bounty (on-chain `fund_bounty`)
- Submit claim (on-chain `submit_claim`)
- Payout (on-chain `payout`, admin-only)
- Refund (on-chain `refund`, funder-only, requires `FundingReceipt`)

Non-goals for the first iteration:

- Backend-enforced GitHub authorization (EVM-style `claim-auth`/`payout-auth` signatures)
- Multi-coin escrow (contract is SUI-only today)
- Full issue list enrichment via GitHub API (nice-to-have)

## 1. Contract Surface (Reference)

Move module: `sui/gh-bounties/sources/gh_bounties.move`

Entry functions used by the UI:

- `create_bounty(repo: String, issue_number: u64, issue_url: String)`
- `fund_bounty(bounty: &mut Bounty, payment: Coin<SUI>, lock_seconds: u64, clock: &Clock)`
- `submit_claim(bounty: &Bounty, claim_url: String, clock: &Clock)`
- `payout(bounty: &mut Bounty, recipient: address, amount_mist: u64)` (admin-only)
- `refund(bounty: &mut Bounty, receipt: FundingReceipt, clock: &Clock)` (funder-only, lock must be expired)
- Optional: `close_bounty(bounty: &mut Bounty)` (admin-only)

Implications for the dapp:

- `fund_bounty`, `submit_claim`, and `refund` require the Sui Clock object as an input.
- `refund` requires the user to *own* the `FundingReceipt` object and pass it as an owned-object argument.

## 2. Required Configuration

Add these web env vars (Vercel + `.env.local.example` + local docs):

- `NEXT_PUBLIC_SUI_PACKAGE_ID`: published package id containing `gh_bounties` (e.g. testnet `0x...`)
- `NEXT_PUBLIC_SUI_CLOCK_OBJECT_ID`: default to `0x6` (Sui Clock); allow override for localnet if needed

Optional, if we want strict network hygiene:

- `NEXT_PUBLIC_SUI_CHAIN`: `testnet|devnet|mainnet` (already exists as `NEXT_PUBLIC_SUI_NETWORK`)

Files:

- `apps/web-sui/.env.local.example` (update)
- `apps/web-sui/src/app/page.tsx` (read env vars + validate)

## 3. UX: Screen/Component Plan

Current entry point is the header button in `apps/web-sui/src/app/page.tsx`:

- Replace the “read-only” CTA box with a modal-driven flow.

Recommended UI structure (keeps `page.tsx` small and testable):

- `apps/web-sui/src/components/flows/AddIssueFundModal.tsx`
- `apps/web-sui/src/components/flows/CreateBountyForm.tsx`
- `apps/web-sui/src/components/flows/FundBountyForm.tsx`
- `apps/web-sui/src/components/flows/SubmitClaimForm.tsx`
- `apps/web-sui/src/components/flows/PayoutForm.tsx`
- `apps/web-sui/src/components/flows/RefundPanel.tsx`
- `apps/web-sui/src/lib/suiTx.ts` (TransactionBlock builders + helpers)
- `apps/web-sui/src/lib/github.ts` (parse/validate GitHub URLs; optional API fetch)

Minimal UX choices:

- “Add issue / fund bounty” opens a modal with:
  - GitHub issue URL input (required)
  - Amount (SUI) input (optional if create-only is allowed)
  - Lock duration (seconds) input (default `0`)
  - Primary action:
    - If bounty exists: fund it
    - If not: create then fund (two txs in v1)
- Each bounty row has an overflow menu that expands to:
  - “Fund”
  - “Submit claim”
  - “Payout” (only if `account.address` matches `admin`)
  - “Refund” (only if current wallet owns relevant receipts)

## 4. Core Technical Work (Web)

### 4.1. Issue URL parsing + validation

Implement local validation first; optional server-side validation later.

- Parse input like `https://github.com/<owner>/<repo>/issues/<n>`
- Derive:
  - `repo = "<owner>/<repo>"`
  - `issue_number = n`
  - `issue_url = canonical URL`
- Reject:
  - non-GitHub URLs
  - wrong path (`pull` vs `issues`)
  - non-integer issue numbers

File:

- `apps/web-sui/src/lib/github.ts`

### 4.2. On-chain transaction builders

Use `@mysten/sui/transactions` + dapp-kit signing.

Build helpers that produce a `Transaction` (or transaction block) for each flow:

1. Create bounty
   - target: `${PACKAGE_ID}::gh_bounties::create_bounty`
   - args: repo, issue_number, issue_url
   - response parsing: capture created/shared bounty object id from `objectChanges` if we want instant navigation

2. Fund bounty
   - split gas coin into payment coin: `tx.splitCoins(tx.gas, [amountMist])`
   - target: `${PACKAGE_ID}::gh_bounties::fund_bounty`
   - args: bounty object, payment coin, lock_seconds, clock object

3. Submit claim
   - target: `${PACKAGE_ID}::gh_bounties::submit_claim`
   - args: bounty object (immutable), claim_url, clock object

4. Payout (admin)
   - target: `${PACKAGE_ID}::gh_bounties::payout`
   - args: bounty object (mutable), recipient address, amount_mist

5. Refund
   - target: `${PACKAGE_ID}::gh_bounties::refund`
   - args: bounty object (mutable), receipt object (owned), clock object

Files:

- `apps/web-sui/src/lib/suiTx.ts`
- `apps/web-sui/src/app/page.tsx` (wiring + optimistic UI + refresh)

### 4.3. Receipt discovery (required for refunds)

There are two viable approaches; do (1) first for correctness, then (2) for UX.

1) Query wallet-owned objects directly from RPC (recommended baseline):

- `getOwnedObjects` filtered by struct type:
  - `${PACKAGE_ID}::gh_bounties::FundingReceipt`
- For each receipt, read fields `bounty_id`, `amount_mist`, `locked_until_ms`
- Show refund button for receipts where:
  - `receipt.bounty_id == bountyObjectId`
  - `now >= locked_until_ms`

2) Extend API response to include `receiptObjectId` in `fundings` (nice-to-have):

- API already stores it in Prisma (`Funding.receiptObjectId`), but does not currently return it.
- Returning it enables:
  - “Refund from table row” without an RPC scan
  - Better debugging links to explorer

If doing (2), update:

- `apps/api-sui/src/server.ts` serialization types to include `receiptObjectId`
- `apps/web-sui/src/app/page.tsx` `SuiFunding` type + rendering

### 4.4. Data refresh + status UX

After each successful transaction:

- Immediately show toast/banner with tx digest + explorer link
- Call `fetchIssues()` to reflect indexed updates

Notes:

- Indexing is polling-based (`SUI_POLL_INTERVAL_MS`), so expect a delay.
- For good UX, use an optimistic “pending” row state keyed by tx digest.

## 5. API Additions (Optional but Useful)

The write flows can be fully client-to-chain. API changes are optional for v1, but some will make the UX smoother.

### 5.1. Expose chain config for the web

Add to `apps/api-sui`:

- `GET /contract`-equivalent (name can be `GET /config`):
  - `packageId`
  - `rpcUrl` (optional)
  - `network` (optional)

This avoids hardcoding package ids in Vercel env, but requires API deploy coordination.

### 5.2. Return object ids for explorer links

Extend API response objects (no breaking changes if additive):

- Funding: include `receiptObjectId`
- Claim: include `claimObjectId`

Files:

- `apps/api-sui/src/server.ts`

## 6. Security / Abuse Considerations

- Validate GitHub URLs before sending on-chain strings.
  - `issue_url` and `claim_url` are stored on-chain; garbage input is permanent.
- Enforce admin-only payout in the UI, but rely on Move checks as the real enforcement.
- Ensure network/package mismatch is caught early:
  - If `NEXT_PUBLIC_SUI_NETWORK=testnet`, require package id is the testnet one (document this convention).
- Guard against confusing units:
  - UI input in SUI (decimal), convert to Mist (u64) using `1e9`.
  - Show both “requested” and “available escrow” before payout/refund actions.

## 7. Testing Plan

### 7.1. Local Sui + deterministic dev data (recommended)

- Stand up localnet / devnet package publish for `sui/gh-bounties`
- Seed flows via CLI or small scripts:
  - create bounty
  - fund bounty
  - claim + payout
  - lock + refund after expiry

### 7.2. Web unit tests (lightweight)

At minimum:

- GitHub URL parser tests
- Mist/SUI conversion tests

(If the repo doesn’t use a test runner in `apps/web-sui` yet, keep tests minimal or colocate in `packages/shared` if available.)

### 7.3. Manual test matrix (release gate)

- Wallet connect/disconnect; reload persistence
- Create bounty with valid issue URL
- Fund existing bounty
- Claim with PR URL
- Payout by admin wallet
- Refund by funder after lock expiry (must own receipt)

## 8. Milestones

1) Web-only write MVP (no API changes)

- Add package id + clock id env vars
- Implement create/fund/claim/payout tx builders
- Implement receipt discovery via RPC + refund flow
- Replace read-only CTA with real modal/forms

2) UX polish + API add-ons

- API: include object ids in responses
- API: optional `/config` endpoint
- Better pending states + per-row action menus

3) “One-click create+fund” (optional contract enhancement)

Two options:

- Add Move `create_and_fund_bounty(...)` entry so it can be done atomically in one tx.
- Or refactor `create_bounty` to accept an optional payment and lock, fund before `share_object`.

## 9. Open Questions

- Should the bounty “admin” be the wallet that created it (current contract), or should it be derived from GitHub identity (requires an auth system + contract changes)?
- Should Sui web also support GitHub login to reduce phishing/mistakes (validating URLs, verifying PR author) even if enforcement is social in v1?
- Do we want to mirror EVM’s “bountyId” determinism (hash of repo+issue) on Sui, or keep the “object id is identity” model?

