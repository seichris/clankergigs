#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd cast
require_env RPC_URL
require_env CONTRACT_ADDRESS
require_env PRIVATE_KEY

if [ $# -lt 2 ]; then
  echo "Usage: $0 <bounty_id> <token_addr>" >&2
  echo "Use token 0x0000000000000000000000000000000000000000 for ETH." >&2
  exit 1
fi

bounty_id="$1"
token="$2"

cast send \
  "$CONTRACT_ADDRESS" \
  "withdrawAfterTimeout(bytes32,address)" \
  "$bounty_id" \
  "$token" \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY"

