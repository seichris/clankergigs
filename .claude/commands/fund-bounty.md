# /project:fund-bounty

Fund a bounty (ETH) for an existing GitHub issue, using `scripts-for-ai-agents/*`.

## Required inputs (ask if missing)

- Repo: `owner/repo` (or full GitHub URL)
- Issue number: integer
- Issue URL: `https://github.com/<owner>/<repo>/issues/<n>`
- Amount (ETH): decimal string (example: `0.01`)
- Lock seconds: integer (default `0`)
- Network selection: ensure `API_URL`, `RPC_URL`, `CHAIN_ID`, `CONTRACT_ADDRESS` point to the intended network

## Safety

- Do not print `PRIVATE_KEY` or any auth tokens.
- Before sending any transaction, restate: network, `bountyId`, `amountEth`, `lockSeconds`.

## Steps

```bash
set -euo pipefail

gh auth status
./scripts-for-ai-agents/01_health.sh

eval "$(./scripts-for-ai-agents/02_ids.sh "$REPO" "$ISSUE_NUMBER")"
./scripts-for-ai-agents/03_read_bounty.sh "$BOUNTY_ID"
createdAt="$(./scripts-for-ai-agents/03_read_bounty_created_at.sh "$BOUNTY_ID")"

if [ "$createdAt" = "0" ]; then
  ./scripts-for-ai-agents/04_create_bounty.sh "$REPO" "$ISSUE_NUMBER" "$ISSUE_URL"
fi

# Fund with ETH:
./scripts-for-ai-agents/05_fund_bounty_eth.sh "$BOUNTY_ID" "$AMOUNT_ETH" "${LOCK_SECONDS:-0}"
```

## Output

- The tx hash from `cast send` for create (if needed) and fund.
