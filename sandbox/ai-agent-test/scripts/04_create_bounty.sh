#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd cast
require_env RPC_URL
require_env CONTRACT_ADDRESS
require_env PRIVATE_KEY

if [ $# -lt 3 ]; then
  echo "Usage: $0 <owner/repo|url> <issue_number> <issue_url>" >&2
  exit 1
fi

repo_input="$1"
issue_number="$2"
issue_url="$3"

repo_norm="$(normalize_repo "$repo_input")"
repo_hash="$(cast keccak "$repo_norm")"

cast send \
  "$CONTRACT_ADDRESS" \
  "createBounty(bytes32,uint256,string)" \
  "$repo_hash" \
  "$issue_number" \
  "$issue_url" \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY"
