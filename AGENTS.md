# AGENTS.md

Instructions for contributors (human or agent) working in this repo.

## Repo Structure

- `contracts/`: Foundry (Solidity) smart contracts + tests + deploy script.
- `apps/api/`: Fastify API + Prisma (SQLite by default) + on-chain indexer (viem).
- `apps/web/`: Next.js web UI (manual MVP to create/fund/claim/payout).
- `packages/shared/`: shared helpers (repo hash + bounty id, token addresses).

This is a `pnpm` workspace (see `pnpm-workspace.yaml`).

## Local Dev

- Install deps: `pnpm install`
- Run everything: `pnpm dev`

EVM local dev (Anvil):
- Start chain: `pnpm contracts:anvil`
- Deploy: `pnpm contracts:deploy:local` (prints contract address)
- Env:
  - copy `.env.example` -> `.env` and set `CONTRACT_ADDRESS`
  - copy `apps/web/.env.local.example` -> `apps/web/.env.local` and set `NEXT_PUBLIC_CONTRACT_ADDRESS`
- Run:
  - `pnpm --filter @gh-bounties/api dev`
  - `pnpm --filter @gh-bounties/web dev`

## GitHub Automation

The indexer can do repo-level automation based on on-chain events:
- Label sync on bounty create / status changes.
- Issue comments on: bounty funded, claim submitted, payout completed.

Auth modes (default is PAT):
- PAT mode (default): `GITHUB_AUTH_MODE=pat` + `GITHUB_TOKEN` (PAT).
- GitHub App mode: `GITHUB_AUTH_MODE=app` + `GITHUB_APP_ID` + `GITHUB_INSTALLATION_ID` + `GITHUB_PRIVATE_KEY_PEM`.

Notes:
- PAT mode does NOT require installing a GitHub App, but the PAT user must have sufficient repo permissions
  to create labels / post comments.
- App mode requires the repo admin to install the app on the target repo.
- Webhooks (`POST /github/webhook`) are currently only verified + logged; on-chain indexing is the source of truth.

## Conventions / Guardrails

- Use `pnpm` (keep `pnpm-lock.yaml` in sync when changing deps).
- `apps/api` is ESM; keep `.js` import specifiers in TS (e.g. `./env.js`) as the codebase does today.
- GitHub actions (labels/comments) should be best-effort and must not break indexing if GitHub fails.
- Avoid spamming historical issues: skip side effects during indexer backfill unless explicitly requested.
- Never commit secrets (`.env`, private keys, tokens).

## Quick Checks

- Typecheck: `pnpm typecheck`
- Lint: `pnpm lint`
- Contracts tests: `pnpm contracts:test`
