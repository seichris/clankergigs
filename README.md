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

## Local dev (Sepolia)
1) Deploy the contract to Sepolia (once per version):
   - `RPC_URL=... PRIVATE_KEY=... pnpm contracts:deploy`
   - copy the printed contract address
2) Set env (root):
   - copy `.env.example` -> `.env`
   - set `RPC_URL` to your Sepolia RPC
   - set `CHAIN_ID=11155111`
   - set `CONTRACT_ADDRESS` to the deployed address
3) Set env (web):
   - copy `apps/web/.env.local.example` -> `apps/web/.env.local`
   - set `NEXT_PUBLIC_CHAIN_ID=11155111`
   - set `NEXT_PUBLIC_RPC_URL` to your Sepolia RPC
   - set `NEXT_PUBLIC_CONTRACT_ADDRESS` to the deployed address
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
  - can auto-apply bounty labels and post issue comments when it sees on-chain events
    (default: `GITHUB_AUTH_MODE=pat` with a `GITHUB_TOKEN` PAT; switch to App mode with `GITHUB_AUTH_MODE=app`)

## Roadmap
- Version B) Authorize payouts via GitHub auth + backend signer (EIP-712), no repo registration required.
