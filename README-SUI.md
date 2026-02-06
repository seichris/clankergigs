# Sui implementation (gh-bounties)

This repo contains an EVM implementation (Ethereum mainnet + Sepolia) **and** a Sui implementation built as a **separate stack**.

See `SUI.md` for the broader implementation plan and hackathon build plan. This file documents the **current architecture** and how to run/deploy it.

## Architecture (today)

We run separate stacks per chain family / network to keep identifiers unambiguous and to avoid mixing indexers/DBs:

- **EVM mainnet**
  - Web: `www.clankergigs.com` (Vercel, `apps/web`)
  - API: `api.clankergigs.com` (Coolify VPS, `apps/api`)
  - DB: SQLite (Prisma) file dedicated to mainnet
- **EVM Sepolia**
  - Web: `sepolia.clankergigs.com` (Vercel, `apps/web`)
  - API: `api-sepolia.clankergigs.com` (Coolify VPS, `apps/api`)
  - DB: SQLite (Prisma) file dedicated to Sepolia
- **Sui testnet**
  - Web: `sui.clankergigs.com` (Vercel, `apps/web-sui`)
  - API: `api-sui.clankergigs.com` (Coolify VPS, `apps/api-sui`)
  - DB: SQLite (Prisma) file dedicated to Sui
  - On-chain package: Sui Move package `sui/gh-bounties`

## Components

### On-chain (Sui)

- `sui/gh-bounties/`: minimal Sui Move package implementing:
  - `Bounty` escrow object (SUI-only escrow for now)
  - `FundingReceipt` (lock + refund proof)
  - `Claim` (stores `claim_url` on-chain)
  - Events: `BountyCreated`, `BountyFunded`, `ClaimSubmitted`, `Payout`, `Refund`
- `sui/gh-bounties/Published.toml`: records published package ids per network (e.g. testnet `published-at`).

### Off-chain (Sui)

- `apps/api-sui/`: Sui indexer + API
  - Polls Sui RPC via `suix_queryEvents` for events by package id
  - Reads `Bounty` / `Claim` objects via `sui_getObject` to hydrate string fields
  - Stores normalized rows in a Sui-specific SQLite DB (Prisma)
  - Exposes:
    - `GET /health`
    - `GET /issues`
    - `GET /bounties?bountyObjectId=0x...`
- `apps/web-sui/`: Sui web (currently read-only)
  - Simple viewer backed by `apps/api-sui`’s `/issues` API
  - Intended deployment: `sui.clankergigs.com`

## Tech stack

- **Move (Sui framework)**: `sui/gh-bounties`
- **API**: Node.js + TypeScript (ESM) + Fastify + Prisma (SQLite)
- **Indexer**: Sui JSON-RPC polling (`suix_queryEvents`, `sui_getObject`)
- **Web**: Next.js + React

## Environment variables

### `apps/api-sui` (Coolify)

- `SUI_RPC_URL` (testnet fullnode URL, e.g. `https://fullnode.testnet.sui.io:443`)
- `SUI_PACKAGE_ID` (published package id, `0x...`)
- `DATABASE_URL` (separate DB file, e.g. `file:/data/sui.db`)
- `WEB_ORIGIN` (for CORS; should match `https://sui.clankergigs.com`)
- Optional:
  - `PORT` (default `8788`)
  - `SUI_POLL_INTERVAL_MS` (default `2000`)
  - `SUI_EVENT_PAGE_SIZE` (default `50`)

### `apps/web-sui` (Vercel)

- `NEXT_PUBLIC_API_URL` (e.g. `https://api-sui.clankergigs.com`)
- Optional explorer bases:
  - `NEXT_PUBLIC_SUI_EXPLORER_TX` (default `https://suiexplorer.com/txblock/`)
  - `NEXT_PUBLIC_SUI_EXPLORER_OBJECT` (default `https://suiexplorer.com/object/`)

## Local development

### Sui API

- Copy `apps/api-sui/.env.example` → `apps/api-sui/.env`
- Run migrations: `pnpm --filter @gh-bounties/api-sui prisma:migrate`
- Start: `pnpm --filter @gh-bounties/api-sui dev`

### Sui web

- Copy `apps/web-sui/.env.local.example` → `apps/web-sui/.env.local`
- Start: `pnpm --filter @gh-bounties/web-sui dev`

## PITCH (HackMoney / DeFi track)

This is designed to be a credible HackMoney / DeFi-track submission (either “Best Overall” or a “Notable Project”) by pairing a working prototype with Sui-native mechanics.

Sui brings together high performance, strong security, and deep composability. We’re using those properties to turn “GitHub bounties” into **DeFi-native escrow primitives**:

- **High-performance, parallel-friendly model**: each bounty is a dedicated on-chain object with its own escrow balance.
- **Strong security / clean accounting**: each funding action mints a `FundingReceipt` object that encodes lock + refund rights.
- **Composability**: the core escrow primitive can be composed into richer flows (PTBs for “create + swap + fund”, DeepBook routing, yield-bearing escrow, sponsored transactions / zkLogin onboarding).

This repo already demonstrates a working end-to-end pattern (chain indexer → DB → web UI) on Ethereum, and applies the same proven deployment approach on Sui: a **separate Sui API + DB + web** that indexes Sui events and serves a live UI at `sui.clankergigs.com`.

Why this fits the track:

- Built on Sui and uses Sui-specific mechanics (Move objects, event indexing, receipts; designed to expand into PTBs and DeFi integrations).
- Working prototype/demo: Sui package publishes + emits events; `apps/api-sui` indexes; `apps/web-sui` renders a live viewer.
- Clear path beyond hackathon: add wallet flows + PTBs, integrate DeepBook, and expand from SUI-only escrow to multi-coin vaults and richer admin/claim authorization.
