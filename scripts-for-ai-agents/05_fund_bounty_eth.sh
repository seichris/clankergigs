#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd cast
require_env RPC_URL
require_env CONTRACT_ADDRESS
require_env PRIVATE_KEY

if [ $# -lt 2 ]; then
  echo "Usage: $0 <bounty_id> <amount_eth> [lock_seconds]" >&2
  exit 1
fi

bounty_id="$1"
amount_eth="$2"
lock_seconds="${3:-0}"

amount_wei="$(cast to-wei "$amount_eth" ether)"

cast send \
  "$CONTRACT_ADDRESS" \
  "fundBountyETH(bytes32,uint64)" \
  "$bounty_id" \
  "$lock_seconds" \
  --value "$amount_wei" \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY"
