# /project:funder-payout

Funder escape hatch: pay out directly from your own contribution (no API).

This only works if **no backend/DAO payout has occurred** for the bounty (`anyPayoutOccurred == false`).

## Required inputs (ask if missing)

- `BOUNTY_ID` (0x… bytes32)
- Token:
  - For ETH, use `0x0000000000000000000000000000000000000000`
- `RECIPIENT` (0x… address)
- Amount (ETH): decimal string (example: `0.01`)
- Network selection: ensure `RPC_URL`, `CHAIN_ID`, `CONTRACT_ADDRESS` all match

## Safety

- Do not print `PRIVATE_KEY`.
- Before sending the tx, restate: network, `bountyId`, `token`, `recipient`, `amountEth`.
- Pre-check `anyPayoutOccurred` and your remaining contribution.

## Steps (ETH)

```bash
set -euo pipefail

ETH_TOKEN="0x0000000000000000000000000000000000000000"
FUNDER_ADDR="$(cast wallet address --private-key "$PRIVATE_KEY")"

./scripts-for-ai-agents/16_any_payout_occurred.sh "$BOUNTY_ID"
./scripts-for-ai-agents/15_get_contribution.sh "$BOUNTY_ID" "$ETH_TOKEN" "$FUNDER_ADDR"
./scripts-for-ai-agents/17_get_totals.sh "$BOUNTY_ID" "$ETH_TOKEN"

./scripts-for-ai-agents/13_funder_payout.sh "$BOUNTY_ID" "$ETH_TOKEN" "$RECIPIENT" "$AMOUNT_ETH"
```

## Output

- The tx hash from `funderPayout(...)`.
