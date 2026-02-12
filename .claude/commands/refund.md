# /project:refund

Refund a funder (repo admin path): refund-auth (API) + refundWithAuthorization (on-chain).

## Required inputs (ask if missing)

- `BOUNTY_ID` (0x… bytes32)
- Token:
  - For ETH, use `0x0000000000000000000000000000000000000000`
- `FUNDER` (0x… address to refund)
- Amount (ETH): decimal string (example: `0.01`)
- Network selection: ensure `API_URL`, `RPC_URL`, `CHAIN_ID`, `CONTRACT_ADDRESS` all match
- API auth token: `AUTH_TOKEN` (or `GITHUB_TOKEN` or `GHB_TOKEN`)

## Safety

- Do not print any auth token.
- Before requesting signatures or sending transactions, restate: network, `bountyId`, `token`, `funder`, `amountEth`.
- Pre-check contribution and escrow before refunding.

## Steps (ETH refund)

```bash
set -euo pipefail

gh auth status
./scripts-for-ai-agents/01_health.sh

ETH_TOKEN="0x0000000000000000000000000000000000000000"

# Pre-checks
./scripts-for-ai-agents/15_get_contribution.sh "$BOUNTY_ID" "$ETH_TOKEN" "$FUNDER"
./scripts-for-ai-agents/17_get_totals.sh "$BOUNTY_ID" "$ETH_TOKEN"

# refund-auth (API)
r="$(./scripts-for-ai-agents/11_refund_auth.sh "$BOUNTY_ID" "$ETH_TOKEN" "$FUNDER" "$AMOUNT_ETH")"
nonce="$(echo "$r" | jq -r .nonce)"
deadline="$(echo "$r" | jq -r .deadline)"
sig="$(echo "$r" | jq -r .signature)"

# refund (on-chain)
amountWei="$(cast to-wei "$AMOUNT_ETH" ether)"
./scripts-for-ai-agents/12_refund.sh "$BOUNTY_ID" "$ETH_TOKEN" "$FUNDER" "$amountWei" "$nonce" "$deadline" "$sig"
```

## Output

- The tx hash from `refundWithAuthorization(...)`.
