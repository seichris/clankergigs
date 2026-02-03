#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd cast
require_cmd curl
require_cmd jq

require_env API_URL
require_env RPC_URL
require_env CONTRACT_ADDRESS
require_env PRIVATE_KEY
require_env GHB_TOKEN

usage() {
  cat <<'OUT' >&2
Usage:
  10_option2_claim_and_payout.sh --pr-url <url> [--bounty-id <0x..>] [--amount-eth <n>] [--recipient <0x..>] [--auto-fund] [--lock-seconds <n>]

Env vars (required):
  API_URL, RPC_URL, CONTRACT_ADDRESS, PRIVATE_KEY, GHB_TOKEN

Notes:
  - Uses Option 2 (device-flow) API tokens: Authorization: Bearer $GHB_TOKEN
  - By default, does NOT fund. Pass --auto-fund to fund the amount if escrow is insufficient.
OUT
}

BOUNTY_ID="0xab0b1d96a287876a120600078b9e9c332f06d9221fee7074d2ab4c9cc85f3e64"
PR_URL=""
AMOUNT_ETH="0.001"
RECIPIENT=""
LOCK_SECONDS="0"
AUTO_FUND="0"

while [ $# -gt 0 ]; do
  case "$1" in
    --bounty-id)
      BOUNTY_ID="${2:-}"; shift 2;;
    --pr-url)
      PR_URL="${2:-}"; shift 2;;
    --amount-eth)
      AMOUNT_ETH="${2:-}"; shift 2;;
    --recipient)
      RECIPIENT="${2:-}"; shift 2;;
    --lock-seconds)
      LOCK_SECONDS="${2:-}"; shift 2;;
    --auto-fund)
      AUTO_FUND="1"; shift 1;;
    -h|--help)
      usage; exit 0;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 1;;
  esac
done

if [ -z "$PR_URL" ]; then
  echo "Missing required --pr-url" >&2
  usage
  exit 1
fi

if [ -z "$RECIPIENT" ]; then
  RECIPIENT="$(cast wallet address --private-key "$PRIVATE_KEY")"
fi

ETH_TOKEN="0x0000000000000000000000000000000000000000"
AMOUNT_WEI="$(cast to-wei "$AMOUNT_ETH" ether)"

echo "bountyId=$BOUNTY_ID"
echo "prUrl=$PR_URL"
echo "recipient=$RECIPIENT"
echo "amountWei=$AMOUNT_WEI"

totals="$(cast call "$CONTRACT_ADDRESS" "getTotals(bytes32,address)(uint256,uint256,uint256)" "$BOUNTY_ID" "$ETH_TOKEN" --rpc-url "$RPC_URL")"
escrowed="$(echo "$totals" | sed -n '1p' | awk '{print $1}')"
echo "escrowedWei=$escrowed"

if [ "$escrowed" -lt "$AMOUNT_WEI" ]; then
  if [ "$AUTO_FUND" != "1" ]; then
    echo "Insufficient escrow for payout. Pass --auto-fund to fund $AMOUNT_ETH ETH first." >&2
    exit 1
  fi
  echo "--- funding (ETH)"
  "$(dirname "$0")/05_fund_bounty_eth.sh" "$BOUNTY_ID" "$AMOUNT_ETH" "$LOCK_SECONDS"
fi

echo "--- claim-auth (Option 2)"
payload="$(jq -nc \
  --arg bountyId "$BOUNTY_ID" \
  --arg claimer "$RECIPIENT" \
  --arg claimMetadataURI "$PR_URL" \
  '{bountyId:$bountyId, claimer:$claimer, claimMetadataURI:$claimMetadataURI}')"
claim_auth="$(curl -sS "$API_URL/claim-auth" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GHB_TOKEN" \
  -d "$payload")"
echo "$claim_auth" | jq .
claim_nonce="$(echo "$claim_auth" | jq -r .nonce)"
claim_deadline="$(echo "$claim_auth" | jq -r .deadline)"
claim_sig="$(echo "$claim_auth" | jq -r .signature)"

echo "--- submit claim (on-chain)"
"$(dirname "$0")/07_submit_claim.sh" "$BOUNTY_ID" "$PR_URL" "$claim_nonce" "$claim_deadline" "$claim_sig"

echo "--- payout-auth (Option 2)"
payload="$(jq -nc \
  --arg bountyId "$BOUNTY_ID" \
  --arg token "$ETH_TOKEN" \
  --arg recipient "$RECIPIENT" \
  --arg amountWei "$AMOUNT_WEI" \
  '{bountyId:$bountyId, token:$token, recipient:$recipient, amountWei:$amountWei}')"
payout_auth="$(curl -sS "$API_URL/payout-auth" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GHB_TOKEN" \
  -d "$payload")"
echo "$payout_auth" | jq .
p_nonce="$(echo "$payout_auth" | jq -r .nonce)"
p_deadline="$(echo "$payout_auth" | jq -r .deadline)"
p_sig="$(echo "$payout_auth" | jq -r .signature)"

echo "--- payout (on-chain)"
"$(dirname "$0")/09_payout.sh" "$BOUNTY_ID" "$ETH_TOKEN" "$RECIPIENT" "$AMOUNT_WEI" "$p_nonce" "$p_deadline" "$p_sig"

echo "--- totals"
cast call "$CONTRACT_ADDRESS" "getTotals(bytes32,address)(uint256,uint256,uint256)" "$BOUNTY_ID" "$ETH_TOKEN" --rpc-url "$RPC_URL"

