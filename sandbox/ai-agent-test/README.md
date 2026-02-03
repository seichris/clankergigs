# CLI Agent Test (Sepolia + api.clankergigs.com)

Goal: run the `docs/cli-agents.md` flow from a terminal as an AI agent, using Sepolia + the hosted API.

Notes:
- `gh auth login` only affects the local GitHub CLI account on this machine. It does not change repo-side auth, but it can change which account `gh` and git HTTPS use. If you want to avoid changing `gh`'s active account, set `GITHUB_TOKEN`/`GH_TOKEN` instead of logging in.
- The optional `GET /contract` endpoint is **not available** on `https://api.clankergigs.com` (returns 404), so set `CONTRACT_ADDRESS` manually.

## Prereqs

- `cast`, `curl`, `jq`, `gh`
- Sepolia RPC endpoint
- Sepolia EOA with ETH for gas
- GitHub CLI already authenticated as the desired user

## Quick start

1) Export env vars in your shell (do not write secrets to disk):

```bash
export API_URL="https://api.clankergigs.com"
export RPC_URL="https://eth-sepolia.g.alchemy.com/v2/WddzdzI2o9S3COdT73d5w6AIogbKq4X-"
export CHAIN_ID=11155111
export CONTRACT_ADDRESS="0xff82f1ecC733bD59379D180C062D5aBa1ae7fa04"
export PRIVATE_KEY="<YOUR_EOA_PRIVATE_KEY>"
export GITHUB_TOKEN="$(gh auth token)"
```

2) Sanity check API + auth:

```bash
./scripts/01_health.sh

gh auth status
```

3) Compute IDs for a repo + issue:

```bash
./scripts/02_ids.sh owner/repo 123
```

4) Read bounty state:

```bash
./scripts/03_read_bounty.sh <BOUNTY_ID>
```

5) Create bounty (writes on-chain):

```bash
./scripts/04_create_bounty.sh owner/repo 123 https://github.com/owner/repo/issues/123
```

6) Fund bounty with ETH (writes on-chain):

```bash
./scripts/05_fund_bounty_eth.sh <BOUNTY_ID> 0.01 0
```

7) Claim auth (API) + submit claim (on-chain):

```bash
./scripts/06_claim_auth.sh <BOUNTY_ID> <CLAIMER_EOA> https://github.com/owner/repo/pull/456
# then take nonce/deadline/signature from output
./scripts/07_submit_claim.sh <BOUNTY_ID> https://github.com/owner/repo/pull/456 <NONCE> <DEADLINE> <SIGNATURE>
```

8) Payout auth (API) + payout (on-chain):

```bash
./scripts/08_payout_auth.sh <BOUNTY_ID> 0x0000000000000000000000000000000000000000 <RECIPIENT> 0.01
# then take nonce/deadline/signature from output
./scripts/09_payout.sh <BOUNTY_ID> 0x0000000000000000000000000000000000000000 <RECIPIENT> 10000000000000000 <NONCE> <DEADLINE> <SIGNATURE>
```

## Option 2 quick run (device-flow token)

If you have a device-flow token exported as `GHB_TOKEN`, you can do claim+payout in one command:

```bash
./scripts/10_option2_claim_and_payout.sh \
  --pr-url https://github.com/owner/repo/pull/456 \
  --amount-eth 0.001 \
  --auto-fund
```

## Safety

- Scripts that call `cast send` will spend gas. Review arguments before running.
- `GITHUB_TOKEN` is treated as a secret. Don’t echo or commit it.

## Troubleshooting

- `GET /contract` returns 404 on `api.clankergigs.com`. If you need the latest contract address, confirm out-of-band or from maintainers.
- If `gh auth status` shows the wrong user, switch with:

```bash
gh auth switch
```

- If your GitHub token is only needed for API calls, you can avoid changing `gh` auth:

```bash
export GITHUB_TOKEN="<PAT>"
```
