# /project:any-payout-occurred

Read whether any backend/DAO payout has occurred for a bounty.

If `true`, funder escape hatches (`funderPayout`, `withdrawAfterTimeout`) are locked out.

## Required inputs (ask if missing)

- `BOUNTY_ID` (0x… bytes32)
- Network selection: ensure `RPC_URL`, `CHAIN_ID`, `CONTRACT_ADDRESS` all match

## Steps

```bash
set -euo pipefail

./scripts-for-ai-agents/16_any_payout_occurred.sh "$BOUNTY_ID"
```

