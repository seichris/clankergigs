#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd cast

if [ $# -lt 2 ]; then
  echo "Usage: $0 <owner/repo|url> <issue_number>" >&2
  exit 1
fi

repo_input="$1"
issue_number="$2"

repo_norm="$(normalize_repo "$repo_input")"

repo_hash="$(cast keccak "$repo_norm")"
encoded="$(cast abi-encode "f(bytes32,uint256)" "$repo_hash" "$issue_number")"
bounty_id="$(cast keccak "$encoded")"

cat <<OUT
repo=$repo_norm
repoHash=$repo_hash
bountyId=$bounty_id
export REPO_HASH=$repo_hash
export BOUNTY_ID=$bounty_id
OUT
