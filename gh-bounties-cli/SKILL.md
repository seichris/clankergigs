---
name: gh-bounties-cli
description: Operate the gh-bounties project from a terminal: compute bounty IDs, read/create/fund bounties, submit claims, and authorize payouts/refunds using the repo's scripts-for-ai-agents and GitHub CLI. Use when asked to run OpenClaw/CLI bounty flows (create/fund/claim/payout/refund/withdraw), debug API auth or RPC issues, or perform on-chain actions safely.
---

# gh-bounties-cli

## Non-negotiable guardrails

- Never print or paste secrets: `PRIVATE_KEY`, `GITHUB_TOKEN`, `GHB_TOKEN`, `AUTH_TOKEN`.
- Before any write transaction (`cast send`), confirm:
  - target network (mainnet vs sepolia vs local)
  - `CHAIN_ID`, `RPC_URL`, `CONTRACT_ADDRESS`
  - `bountyId`, `token`, `recipient`, `amount`
- Prefer `scripts-for-ai-agents/*` over ad-hoc `cast` / `curl` commands.
- Treat `AGENTS.md` as the canonical reference; this skill is the execution checklist.

## Quick start (sanity)

```bash
gh auth status
./scripts-for-ai-agents/01_health.sh
curl -sS "$API_URL/contract" | jq .
```

If any env is missing, use:

- `./scripts-for-ai-agents/env.mainnet.example.sh`
- `./scripts-for-ai-agents/env.sepolia.example.sh`

Copy to `env.mainnet.sh` / `env.sepolia.sh` locally (do not commit) and `source` it.

## Common env vars (what scripts expect)

- Chain: `RPC_URL`, `CHAIN_ID`, `CONTRACT_ADDRESS`
- API: `API_URL`
- Signing: `PRIVATE_KEY` (required for on-chain writes)
- API auth (pick one):
  - `AUTH_TOKEN` (preferred by scripts)
  - `GITHUB_TOKEN` (Option 1)
  - `GHB_TOKEN` (Option 2 device-flow)

## Bounty flow: compute IDs → read/create → fund

1. Compute `repoHash` + `bountyId`:

```bash
./scripts-for-ai-agents/02_ids.sh owner/repo 123
# optional: set env vars in the current shell
eval "$(./scripts-for-ai-agents/02_ids.sh owner/repo 123)"
echo "$BOUNTY_ID"
```

2. Read bounty (check `createdAt` in output):

```bash
./scripts-for-ai-agents/03_read_bounty.sh "$BOUNTY_ID"
```

3. If missing, create:

```bash
./scripts-for-ai-agents/04_create_bounty.sh owner/repo 123 "https://github.com/owner/repo/issues/123"
```

4. Fund (ETH):

```bash
./scripts-for-ai-agents/05_fund_bounty_eth.sh "$BOUNTY_ID" 0.01 0
```

## Claim flow: claim-auth (API) → submitClaim (chain)

Inputs:

- `BOUNTY_ID` (or compute it from repo + issue number)
- claimer EOA address
- PR URL: `https://github.com/<owner>/<repo>/pull/<n>`

Steps:

```bash
claim="$(./scripts-for-ai-agents/06_claim_auth.sh "$BOUNTY_ID" "$CLAIMER_EOA" "$PR_URL")"
nonce="$(echo "$claim" | jq -r .nonce)"
deadline="$(echo "$claim" | jq -r .deadline)"
sig="$(echo "$claim" | jq -r .signature)"

./scripts-for-ai-agents/07_submit_claim.sh "$BOUNTY_ID" "$PR_URL" "$nonce" "$deadline" "$sig"
```

## Payout flow: payout-auth (API) → payout (chain)

Notes:

- Use `0x0000000000000000000000000000000000000000` for ETH.
- `08_payout_auth.sh` takes `amount_eth`; `09_payout.sh` takes `amount_wei`.

Steps:

```bash
ETH_TOKEN="0x0000000000000000000000000000000000000000"

p="$(./scripts-for-ai-agents/08_payout_auth.sh "$BOUNTY_ID" "$ETH_TOKEN" "$RECIPIENT" 0.01)"
amountWei="$(echo "$p" | jq -r .amountWei)"
nonce="$(echo "$p" | jq -r .nonce)"
deadline="$(echo "$p" | jq -r .deadline)"
sig="$(echo "$p" | jq -r .signature)"

./scripts-for-ai-agents/09_payout.sh "$BOUNTY_ID" "$ETH_TOKEN" "$RECIPIENT" "$amountWei" "$nonce" "$deadline" "$sig"
```

## Refund flow: refund-auth (API, repo admin) → refund (chain)

Notes:

- Refunds are backend-authorized and require the authenticated GitHub user to be a repo admin.
- Refunds reduce the funder’s contribution (unlike backend-authorized payouts).

Steps:

```bash
ETH_TOKEN="0x0000000000000000000000000000000000000000"

# Optional pre-checks
./scripts-for-ai-agents/15_get_contribution.sh "$BOUNTY_ID" "$ETH_TOKEN" "$FUNDER"
./scripts-for-ai-agents/17_get_totals.sh "$BOUNTY_ID" "$ETH_TOKEN"

r="$(./scripts-for-ai-agents/11_refund_auth.sh "$BOUNTY_ID" "$ETH_TOKEN" "$FUNDER" 0.01)"
nonce="$(echo "$r" | jq -r .nonce)"
deadline="$(echo "$r" | jq -r .deadline)"
sig="$(echo "$r" | jq -r .signature)"
amountWei="$(cast to-wei 0.01 ether)"

./scripts-for-ai-agents/12_refund.sh "$BOUNTY_ID" "$ETH_TOKEN" "$FUNDER" "$amountWei" "$nonce" "$deadline" "$sig"
```

## Funder payout (no API): funderPayout (chain)

This is a funder escape hatch. It only works if `anyPayoutOccurred(bountyId) == false`.

```bash
ETH_TOKEN="0x0000000000000000000000000000000000000000"
./scripts-for-ai-agents/16_any_payout_occurred.sh "$BOUNTY_ID"
./scripts-for-ai-agents/13_funder_payout.sh "$BOUNTY_ID" "$ETH_TOKEN" "$RECIPIENT" 0.01
```

## Withdraw after timeout (no API): withdrawAfterTimeout (chain)

This is a funder escape hatch. It only works if:

- `anyPayoutOccurred(bountyId) == false`
- your `lockedUntil` has passed

```bash
ETH_TOKEN="0x0000000000000000000000000000000000000000"
./scripts-for-ai-agents/16_any_payout_occurred.sh "$BOUNTY_ID"
./scripts-for-ai-agents/14_withdraw_after_timeout.sh "$BOUNTY_ID" "$ETH_TOKEN"
```

## Option 2 convenience: claim + payout in one script

If you already have a device-flow token (`GHB_TOKEN`):

```bash
./scripts-for-ai-agents/10_option2_claim_and_payout.sh \
  --pr-url "https://github.com/owner/repo/pull/456" \
  --issue-url "https://github.com/owner/repo/issues/123" \
  --amount-eth 0.001 \
  --auto-fund
```

## Debug checklist

- 401/403 from API: missing/invalid `AUTH_TOKEN`/`GITHUB_TOKEN`/`GHB_TOKEN`.
- `GET $API_URL/contract` returns 404: often OK (scripts already warn it “may be 404”).
- Network mismatch: ensure `API_URL`, `RPC_URL`, `CHAIN_ID`, `CONTRACT_ADDRESS` all point to the same chain.
- Claim-auth fails: PR repo must match bounty repo, and the authenticated GitHub user must be the PR author (see `AGENTS.md` for details).
