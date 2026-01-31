# gh-bounties

Fund specific GitHub issues with ETH ("bounties"). Developers submit claims (PR links). Repo maintainer approves payouts from escrow.

## Repo layout
- `contracts/` Foundry project (Solidity)
- `apps/api/` Fastify + Prisma (indexes contract events; GitHub integration later)
- `apps/web/` Next.js UI (manual mode: paste issue/PR URLs, call contract via injected wallet)
- `packages/shared/` shared helpers (repo hash + bounty id)

## Local dev (Anvil)
1) Start a local chain:
   - `pnpm contracts:anvil`
2) Deploy the contract (in another terminal):
   - `pnpm contracts:deploy:local`
3) Set env:
   - copy `.env.example` -> `.env`
   - put the deployed `CONTRACT_ADDRESS` into `.env`
   - copy `apps/web/.env.local.example` -> `apps/web/.env.local`
   - put the same contract address into `apps/web/.env.local`
   - for USDC on Sepolia/mainnet you can paste a token address into the UI, or rely on the auto-fill defaults
4) Run API + web:
   - `pnpm --filter @gh-bounties/api dev`
   - `pnpm --filter @gh-bounties/web dev`

## Deploy (Sepolia / Mainnet)
- Contract deploy prints the deployed address:
  - `RPC_URL=... PRIVATE_KEY=... pnpm contracts:deploy`

## Notes
- On-chain contract cannot index GitHub issues/PRs. The API will index contract events + fetch GitHub data off-chain.
- GitHub App integration is WIP. The API now:
  - verifies incoming webhooks at `/github/webhook`
  - can auto-apply bounty labels and post funding comments when it sees on-chain events (requires GitHub App env vars or a `GITHUB_TOKEN` PAT; app creds take precedence)
