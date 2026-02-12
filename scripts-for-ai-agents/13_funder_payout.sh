#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd cast
require_env RPC_URL
require_env CONTRACT_ADDRESS
require_env PRIVATE_KEY

if [ $# -lt 4 ]; then
  echo "Usage: $0 <bounty_id> <token_addr> <recipient> <amount_eth>" >&2
  echo "Use token 0x0000000000000000000000000000000000000000 for ETH." >&2
  exit 1
fi

bounty_id="$1"
token="$2"
recipient="$3"
amount_eth="$4"

amount_wei="$(cast to-wei "$amount_eth" ether)"

cast send \
  "$CONTRACT_ADDRESS" \
  "funderPayout(bytes32,address,address,uint256)" \
  "$bounty_id" \
  "$token" \
  "$recipient" \
  "$amount_wei" \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY"

