# gh-bounties

Fund specific GitHub issues with ETH ("bounties"). Developers submit claims (PR links). Payouts are authorized via GitHub login (API verifies repo admin and signs an EIP-712 authorization the contract enforces).

Humans can access the full flow via https://www.clankergigs.com.

AI agents can do the same via CLI. See [AGENTS.md](AGENTS.md).

## Dev

### Repo layout
- `contracts/` Foundry project (Solidity)
- `apps/api/` Fastify + Prisma (indexes contract events; GitHub automation + payout authorization)
- `apps/web/` Next.js UI (paste issue/PR URLs, call contract via injected wallet)
- `packages/shared/` shared helpers (repo hash + bounty id)

### Setup
- Install deps: `pnpm install`

### Local dev (Anvil)
1) Start a local chain:
   - `pnpm contracts:anvil`
2) Set env:
   - copy `.env.example` -> `.env`
   - set `BACKEND_SIGNER_PRIVATE_KEY` (used by the API to sign payout authorizations)
     - important: this must match the `payoutAuthorizer` baked into the contract at deploy time (the deploy script derives it from `BACKEND_SIGNER_PRIVATE_KEY`)
   - set GitHub OAuth env vars (used by “Login with GitHub” in the web UI):
     - `WEB_ORIGIN=http://localhost:3000`
     - `GITHUB_OAUTH_CLIENT_ID=...`
     - `GITHUB_OAUTH_CLIENT_SECRET=...`
     - `GITHUB_OAUTH_CALLBACK_URL=http://localhost:8787/auth/github/callback`
3) Deploy the contract (in another terminal):
   - `pnpm contracts:deploy:local`
   - put the deployed `CONTRACT_ADDRESS` into `.env`
4) Set web env:
   - copy `apps/web/.env.local.example` -> `apps/web/.env.local`
   - put the same contract address into `apps/web/.env.local`
   - keep `NEXT_PUBLIC_API_URL=http://localhost:8787` (use `localhost`, not `127.0.0.1`, so the session cookie works)
   - for USDC on Sepolia/mainnet you can paste a token address into the UI, or rely on the auto-fill defaults
5) Run API + web:
   - (first time only) `pnpm --filter @gh-bounties/api prisma:migrate`
   - `pnpm --filter @gh-bounties/api dev`
   - `pnpm --filter @gh-bounties/web dev`

### Local dev (Sepolia)
1) Set env (root):
   - copy `.env.example` -> `.env`
   - set `RPC_URL` to your Sepolia RPC
   - set `CHAIN_ID=11155111`
   - (optional) Sepolia deployment: `0xff82f1ecC733bD59379D180C062D5aBa1ae7fa04`
   - set `BACKEND_SIGNER_PRIVATE_KEY` (used by the API to sign payout authorizations; must match the `payoutAuthorizer` set at deploy time). Required for deploys.
   - set GitHub OAuth env vars (used by “Login with GitHub” in the web UI)
2) Deploy the contract to Sepolia (once per version):
   - `RPC_URL=... PRIVATE_KEY=... pnpm contracts:deploy`
   - copy the printed contract address
   - set `CONTRACT_ADDRESS` to the deployed address (in `.env`)
3) Set env (web):
   - copy `apps/web/.env.local.example` -> `apps/web/.env.local`
   - set `NEXT_PUBLIC_CHAIN_ID=11155111`
   - set `NEXT_PUBLIC_RPC_URL` to your Sepolia RPC
   - set `NEXT_PUBLIC_CONTRACT_ADDRESS` to the deployed address
4) Run API + web:
   - `pnpm --filter @gh-bounties/api dev`
   - `pnpm --filter @gh-bounties/web dev`

### Deploy (Sepolia / Mainnet)
- Contract deploy prints the deployed address:
  - `RPC_URL=... PRIVATE_KEY=... pnpm contracts:deploy`

## Roadmap
- Use zkTLS to reduce trust in our backend that attests with EIP‑712 signatures
- Add DAO UI (contract supports DAO fallback payout/refund after a delay; the Safe can sign with its own UI).
- Add a x.com account to tweet out all bounties
