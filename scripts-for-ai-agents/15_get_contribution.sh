#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd cast
require_env RPC_URL
require_env CONTRACT_ADDRESS

if [ $# -lt 3 ]; then
  echo "Usage: $0 <bounty_id> <token_addr> <funder_addr>" >&2
  exit 1
fi

bounty_id="$1"
token="$2"
funder="$3"

cast call \
  "$CONTRACT_ADDRESS" \
  "getContribution(bytes32,address,address)(uint256,uint64)" \
  "$bounty_id" \
  "$token" \
  "$funder" \
  --rpc-url "$RPC_URL"

