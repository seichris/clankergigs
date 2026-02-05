#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd cast
require_env RPC_URL
require_env CONTRACT_ADDRESS
require_env PRIVATE_KEY

if [ $# -lt 5 ]; then
  echo "Usage: $0 <bounty_id> <claim_pr_url> <nonce> <deadline> <signature>" >&2
  exit 1
fi

bounty_id="$1"
claim_url="$2"
nonce="$3"
deadline="$4"
signature="$5"

cast send \
  "$CONTRACT_ADDRESS" \
  "submitClaimWithAuthorization(bytes32,string,uint256,uint256,bytes)" \
  "$bounty_id" \
  "$claim_url" \
  "$nonce" \
  "$deadline" \
  "$signature" \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY"
