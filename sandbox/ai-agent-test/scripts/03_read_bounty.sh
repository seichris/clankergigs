#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd cast
require_env RPC_URL
require_env CONTRACT_ADDRESS

if [ $# -lt 1 ]; then
  echo "Usage: $0 <bounty_id>" >&2
  exit 1
fi

bounty_id="$1"

cast call \
  "$CONTRACT_ADDRESS" \
  "bounties(bytes32)(bytes32,uint256,uint8,uint64,string)" \
  "$bounty_id" \
  --rpc-url "$RPC_URL"
