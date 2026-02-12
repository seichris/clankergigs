#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd cast
require_env RPC_URL
require_env CONTRACT_ADDRESS
require_env PRIVATE_KEY

if [ $# -lt 7 ]; then
  echo "Usage: $0 <bounty_id> <token_addr> <funder> <amount_wei> <nonce> <deadline> <signature>" >&2
  exit 1
fi

bounty_id="$1"
token="$2"
funder="$3"
amount_wei="$4"
nonce="$5"
deadline="$6"
signature="$7"

cast send \
  "$CONTRACT_ADDRESS" \
  "refundWithAuthorization(bytes32,address,address,uint256,uint256,uint256,bytes)" \
  "$bounty_id" \
  "$token" \
  "$funder" \
  "$amount_wei" \
  "$nonce" \
  "$deadline" \
  "$signature" \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY"

