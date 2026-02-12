# /project:totals

Read bounty totals (escrowed/funded/paid) for a token.

## Required inputs (ask if missing)

- `BOUNTY_ID` (0x… bytes32)
- `TOKEN` address
  - For ETH, use `0x0000000000000000000000000000000000000000`
- Network selection: ensure `RPC_URL`, `CHAIN_ID`, `CONTRACT_ADDRESS` all match

## Steps

```bash
set -euo pipefail

./scripts-for-ai-agents/17_get_totals.sh "$BOUNTY_ID" "$TOKEN"
```

