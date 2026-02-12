# /project:payout

Authorize and execute a payout (API payout-auth + on-chain payoutWithAuthorization).

## Required inputs (ask if missing)

- `BOUNTY_ID` (0x… bytes32)
- `RECIPIENT` (0x… address)
- Amount (ETH): decimal string (example: `0.01`)
- Token:
  - For ETH, use `0x0000000000000000000000000000000000000000`
- Network selection: ensure `API_URL`, `RPC_URL`, `CHAIN_ID`, `CONTRACT_ADDRESS` all match
- API auth token: `AUTH_TOKEN` (or `GITHUB_TOKEN` or `GHB_TOKEN`)

## Safety

- Do not print any auth token.
- Before the on-chain step, restate: network, `bountyId`, `token`, `recipient`, `amountEth`.

## Steps (ETH payout)

```bash
set -euo pipefail

gh auth status
./scripts-for-ai-agents/01_health.sh

ETH_TOKEN="0x0000000000000000000000000000000000000000"

p="$(./scripts-for-ai-agents/08_payout_auth.sh "$BOUNTY_ID" "$ETH_TOKEN" "$RECIPIENT" "$AMOUNT_ETH")"
amountWei="$(echo "$p" | jq -r .amountWei)"
nonce="$(echo "$p" | jq -r .nonce)"
deadline="$(echo "$p" | jq -r .deadline)"
sig="$(echo "$p" | jq -r .signature)"

./scripts-for-ai-agents/09_payout.sh "$BOUNTY_ID" "$ETH_TOKEN" "$RECIPIENT" "$amountWei" "$nonce" "$deadline" "$sig"
```

## Output

- The tx hash from `payoutWithAuthorization(...)`.
