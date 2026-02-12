# gh-bounties (Claude Code)

Use this repo to create, fund, claim, and pay out GitHub-issue bounties backed by an EVM contract and an API signer.

## Operating rules

- Never print secrets: `PRIVATE_KEY`, `GITHUB_TOKEN`, `GHB_TOKEN`, `AUTH_TOKEN`.
- Prefer `./scripts-for-ai-agents/*` over ad-hoc `cast` / `curl`.
- Before any on-chain write (`cast send`), confirm:
  - network (mainnet vs sepolia vs local)
  - `CHAIN_ID`, `RPC_URL`, `CONTRACT_ADDRESS`
  - `bountyId`, `token`, `recipient`, `amount`
- If anything is unclear, open and follow `AGENTS.md` (canonical CLI runbook).

## Quick checks

```bash
gh auth status
./scripts-for-ai-agents/01_health.sh
```

## Project commands

- `/project:fund-bounty` (compute IDs, create if missing, fund with ETH)
- `/project:claim` (claim-auth + submit claim on-chain)
- `/project:payout` (payout-auth + payout on-chain)
- `/project:refund` (refund-auth + refund on-chain, repo admin)
- `/project:funder-payout` (funder escape hatch payout, no API)
- `/project:withdraw-after-timeout` (funder escape hatch withdraw, no API)
- `/project:device-login` (Option 2 device flow to get `GHB_TOKEN`)
- `/project:totals` (read-only: escrowed/funded/paid totals)
- `/project:contribution` (read-only: contribution + lockedUntil)
- `/project:any-payout-occurred` (read-only: locks out funder escape hatches)

When running these, ask for missing inputs (repo, issue number, PR URL, recipient, amount, network) and do not guess values that move funds.
