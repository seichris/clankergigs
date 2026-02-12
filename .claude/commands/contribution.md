# /project:contribution

Read a funder's remaining contribution and lock expiry (`lockedUntil`) for a token.

## Required inputs (ask if missing)

- `BOUNTY_ID` (0x… bytes32)
- `TOKEN` address
  - For ETH, use `0x0000000000000000000000000000000000000000`
- `FUNDER` address
- Network selection: ensure `RPC_URL`, `CHAIN_ID`, `CONTRACT_ADDRESS` all match

## Steps

```bash
set -euo pipefail

./scripts-for-ai-agents/15_get_contribution.sh "$BOUNTY_ID" "$TOKEN" "$FUNDER"
```

