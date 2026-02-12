# /project:withdraw-after-timeout

Funder escape hatch: withdraw your remaining contribution after lock expiry (no API).

This only works if **no payout has occurred** for the bounty (`anyPayoutOccurred == false`) and your lock has expired.

## Required inputs (ask if missing)

- `BOUNTY_ID` (0x… bytes32)
- Token:
  - For ETH, use `0x0000000000000000000000000000000000000000`
- Network selection: ensure `RPC_URL`, `CHAIN_ID`, `CONTRACT_ADDRESS` all match

## Safety

- Do not print `PRIVATE_KEY`.
- Before sending the tx, restate: network, `bountyId`, `token`.
- Pre-check `anyPayoutOccurred` and your `lockedUntil`.

## Steps (ETH)

```bash
set -euo pipefail

ETH_TOKEN="0x0000000000000000000000000000000000000000"
FUNDER_ADDR="$(cast wallet address --private-key "$PRIVATE_KEY")"

./scripts-for-ai-agents/16_any_payout_occurred.sh "$BOUNTY_ID"
./scripts-for-ai-agents/15_get_contribution.sh "$BOUNTY_ID" "$ETH_TOKEN" "$FUNDER_ADDR"

./scripts-for-ai-agents/14_withdraw_after_timeout.sh "$BOUNTY_ID" "$ETH_TOKEN"
```

## Output

- The tx hash from `withdrawAfterTimeout(...)`.
