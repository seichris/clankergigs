#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd curl
require_cmd jq
require_cmd cast
require_env API_URL

auth_token="${AUTH_TOKEN:-${GITHUB_TOKEN:-${GHB_TOKEN:-}}}"
if [ -z "${auth_token:-}" ]; then
  echo "Missing auth token: set AUTH_TOKEN (or GITHUB_TOKEN or GHB_TOKEN)" >&2
  exit 1
fi

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

payload=$(jq -nc \
  --arg bountyId "$bounty_id" \
  --arg token "$token" \
  --arg recipient "$recipient" \
  --arg amountWei "$amount_wei" \
  '{bountyId:$bountyId, token:$token, recipient:$recipient, amountWei:$amountWei}')

curl -sS "$API_URL/payout-auth" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $auth_token" \
  -d "$payload" | jq .
