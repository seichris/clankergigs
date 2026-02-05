# @gh-bounties/web-sui

Sui web viewer app (separate deployment) intended for `sui.clankergigs.com`.

## Local dev

- Set env:
  - copy `apps/web-sui/.env.local.example` → `apps/web-sui/.env.local`
  - ensure `NEXT_PUBLIC_API_URL` points at your Sui API (default `http://localhost:8788`)
- Run:
  - `pnpm --filter @gh-bounties/web-sui dev`

