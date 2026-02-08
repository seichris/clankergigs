# @gh-bounties/api-sui

Sui API + event indexer (separate deployment) intended for `api-sui.clankergigs.com`.

## Local dev

- Set env:
  - copy `apps/api-sui/.env.example` → `apps/api-sui/.env`
  - set `SUI_RPC_URL` and `SUI_PACKAGE_ID`
- Migrate DB:
  - `pnpm --filter @gh-bounties/api-sui prisma:migrate`
- Run:
  - `pnpm --filter @gh-bounties/api-sui dev`

