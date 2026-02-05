# gh-bounties (Sui Move package)

This is a minimal Sui Move implementation of the bounty escrow primitives needed by the Sui stack (`apps/api-sui`, `apps/web-sui`).

Notes:
- The indexer in `apps/api-sui` expects the package to emit Move events named:
  - `BountyCreated`
  - `BountyFunded`
  - `ClaimSubmitted`
  - `Payout`
  - `Refund`
- For hackathon-speed iteration, this package focuses on **SUI-only** escrow (no multi-coin vaults yet).

Event field notes:
- `ClaimSubmitted` includes `claim_id` so the indexer can fetch the `Claim` object and read `claim_url`.
- `BountyFunded` includes `receipt_id` so UIs can link to the `FundingReceipt` object for refunds.
