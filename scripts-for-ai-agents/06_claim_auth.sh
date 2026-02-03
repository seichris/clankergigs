#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd curl
require_cmd jq
require_env API_URL
require_env GITHUB_TOKEN

if [ $# -lt 3 ]; then
  echo "Usage: $0 <bounty_id> <claimer_eoa> <claim_pr_url>" >&2
  exit 1
fi

bounty_id="$1"
claimer="$2"
claim_url="$3"

payload=$(jq -nc \
  --arg bountyId "$bounty_id" \
  --arg claimer "$claimer" \
  --arg claimMetadataURI "$claim_url" \
  '{bountyId:$bountyId, claimer:$claimer, claimMetadataURI:$claimMetadataURI}')

curl -sS "$API_URL/claim-auth" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -d "$payload" | jq .
