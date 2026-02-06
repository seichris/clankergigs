# Sui (Move) implementation + roadmap (gh-bounties)

This repo implements **GitHub issue bounties** on Ethereum (Solidity + indexer) and also contains a **Sui implementation**.

Important: the Sui implementation is intentionally a **separate stack** (API + DB + web) and is not mixed into the EVM API/DB. This mirrors the proven “one deployment per network” approach we use for Ethereum mainnet ↔ Sepolia.

For the current “what is deployed where” view, see `README-SUI.md`.

---

## Why Sui for bounties (DeFi framing)

Sui’s object model and composability let us treat each bounty as a **DeFi-native escrow primitive**:

- **Object-per-bounty escrow**: parallel-friendly and easy to reason about.
- **Receipts as positions**: funders get a first-class on-chain object representing their contribution + lock/refund rights.
- **PTBs as UX** (next): “create + swap + fund” can become one atomic interaction.
- **DeFi integration** (next): DeepBook routing, yield-bearing escrow, sponsored transactions / zkLogin onboarding.

---

## Current architecture (what exists today)

We run a dedicated Sui stack, with its own origins and database:

- Web: `sui.clankergigs.com` (`apps/web-sui`)
- API + indexer: `api-sui.clankergigs.com` (`apps/api-sui`)
- DB: separate Prisma/SQLite DB (do not share with EVM), e.g. `DATABASE_URL=file:/data/sui.db`
- On-chain: Move package `sui/gh-bounties` (published ids tracked in `sui/gh-bounties/Published.toml`)

This “separate stack per chain/network” approach is the recommended default:
- it avoids identifier collisions,
- keeps indexers simple,
- and keeps CORS/session/origin rules explicit.

---

## What’s implemented (Sui)

### Move package: `sui/gh-bounties`

Minimal, indexer-friendly core:

- `Bounty` (shared object): `repo` string, `issue_number`, `issue_url`, `admin`, `status`, and `escrow` (currently **SUI-only**).
- `FundingReceipt` (owned object): minted on fund; encodes `amount_mist` + `locked_until_ms` and is required to refund.
- `Claim` (owned object): stores `claim_url` on-chain (for hackathon scope); future work can add richer auth.
- Events: `BountyCreated`, `BountyFunded`, `ClaimSubmitted`, `Payout`, `Refund`.

### Sui API/indexer: `apps/api-sui`

- Polls Sui JSON-RPC (`suix_queryEvents`) filtered by `SUI_PACKAGE_ID`.
- Hydrates string fields by reading objects (`sui_getObject`).
- Normalizes into a Sui-only Prisma schema (SQLite).
- HTTP endpoints:
  - `GET /health`
  - `GET /issues`
  - `GET /bounties?bountyObjectId=0x...`

### Sui web: `apps/web-sui`

- Read-only viewer that lists indexed bounties from the Sui API.
- Write flows (wallet connect + create/fund/claim/payout/refund) are intentionally left for follow-up.

---

## Local development (Sui stack)

### 1) Publish the Move package (testnet)

From `sui/gh-bounties`:

```bash
sui client switch --env testnet
sui client publish --gas-budget 200000000
```

In the publish output, copy the **package id** and set it as `SUI_PACKAGE_ID` for `apps/api-sui`.

Notes:
- Published ids are recorded in `sui/gh-bounties/Published.toml` (committed).
- Keep your Sui keystore/config out of git (this repo uses `.tools/` locally, which is gitignored).

### 2) Run the Sui API/indexer

- Copy `apps/api-sui/.env.example` → `apps/api-sui/.env`
- Run:
  - `pnpm --filter @gh-bounties/api-sui prisma:migrate`
  - `pnpm --filter @gh-bounties/api-sui dev`

### 3) Run the Sui web viewer

- Copy `apps/web-sui/.env.local.example` → `apps/web-sui/.env.local`
- Run:
  - `pnpm --filter @gh-bounties/web-sui dev`

---

## Deployment notes (Sui testnet)

We deploy **two services** for Sui (same pattern as EVM):

- `apps/api-sui` on Coolify (VPS), with its own DB file
- `apps/web-sui` on Vercel

Required env vars:

- **API (`apps/api-sui`)**
  - `SUI_RPC_URL` (e.g. `https://fullnode.testnet.sui.io:443`)
  - `SUI_PACKAGE_ID` (published Move package id)
  - `DATABASE_URL` (e.g. `file:/data/sui.db`)
  - `WEB_ORIGIN` (e.g. `https://sui.clankergigs.com`)
- **Web (`apps/web-sui`)**
  - `NEXT_PUBLIC_API_URL` (e.g. `https://api-sui.clankergigs.com`)

DNS expectations:
- `sui.clankergigs.com` → Vercel project for `apps/web-sui`
- `api-sui.clankergigs.com` → Coolify/VPS for `apps/api-sui`

---

## Roadmap (Sui-specific upgrades)

Keep the current separate-stack approach, and iterate in layers:

1) **Web write flows**: wallet connect + create/fund/claim/payout/refund transactions.
2) **Multi-coin escrow**: extend beyond SUI-only escrow (vault per coin type + safe accounting).
3) **PTB UX**: “create + swap + fund” and “batch payout” PTBs.
4) **DeFi hook**: DeepBook routing for funding-in-any-coin.
5) **Onboarding**: sponsored transactions and zkLogin for claimers.

---

## Resources

- Sui developer docs: https://docs.sui.io
- PTBs: https://docs.sui.io/guides/developer/sui-101/building-ptb
- DeepBook: https://docs.sui.io/standards/deepbook
