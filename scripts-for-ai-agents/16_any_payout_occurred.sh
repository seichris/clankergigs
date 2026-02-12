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
  "anyPayoutOccurred(bytes32)(bool)" \
  "$bounty_id" \
  --rpc-url "$RPC_URL"

