#!/usr/bin/env bash
set -euo pipefail

# Smoke test for Sepolia config (uses your existing root .env).
#
# What it validates:
# - env parses (CHAIN_ID/RPC_URL/CONTRACT_ADDRESS/etc)
# - prisma migrations apply
# - API can boot against Sepolia
# - CLI endpoints respond: /health, /contract, /id
#
# Notes:
# - First run may take a few minutes because the indexer backfills ~2000 blocks.
# - We use a separate sqlite db by default to avoid polluting your dev db.
# - If you want payout-auth / signing enabled, set `BACKEND_SIGNER_PRIVATE_KEY` in your root `.env`
#   (do not commit real keys).

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Default to 8788 to avoid clobbering a local dev server on 8787.
API_PORT="${API_PORT:-8788}"
API_URL="${API_URL:-http://127.0.0.1:${API_PORT}}"

# Isolate smoke DB so repeated tests don't clobber other dev data.
DATABASE_URL="${DATABASE_URL:-file:./prisma/sepolia-smoke.db}"

# Default to 10 to be compatible with Alchemy free-tier eth_getLogs limits.
INDEXER_BACKFILL_BLOCK_CHUNK="${INDEXER_BACKFILL_BLOCK_CHUNK:-10}"

API_LOG="${API_LOG:-/tmp/ghb_api_sepolia.log}"

cleanup() {
  if [[ -n "${API_PID:-}" ]]; then
    kill "${API_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "Applying prisma migrations (${DATABASE_URL})..."
(
  cd "${ROOT_DIR}/apps/api"
  DATABASE_URL="${DATABASE_URL}" pnpm exec prisma migrate deploy >/dev/null
)

echo "Starting API on ${API_URL} (Sepolia)…"
(
  cd "${ROOT_DIR}/apps/api"
  # Use root .env (env.ts default is ../../.env). Override a few values for this run.
  export DATABASE_URL="${DATABASE_URL}"
  export PORT="${API_PORT}"
  export INDEXER_BACKFILL_BLOCK_CHUNK="${INDEXER_BACKFILL_BLOCK_CHUNK}"
  pnpm exec tsx src/index.ts
) >"${API_LOG}" 2>&1 &
API_PID=$!

echo "Waiting for API /health (may take a bit on first run due to indexer backfill)…"
for i in {1..600}; do
  if ! kill -0 "${API_PID}" >/dev/null 2>&1; then
    echo "API process exited early." >&2
    echo "Last logs:" >&2
    tail -n 160 "${API_LOG}" >&2 || true
    exit 1
  fi
  if curl -s "${API_URL}/health" | jq -e '.ok==true' >/dev/null 2>&1; then
    break
  fi
  sleep 1
  if [[ "${i}" -eq 600 ]]; then
    echo "API did not become healthy in time." >&2
    echo "Last logs:" >&2
    tail -n 120 "${API_LOG}" >&2 || true
    exit 1
  fi
done

echo
echo "GET /contract"
contract_json="$(curl -s "${API_URL}/contract")"
echo "${contract_json}" | jq '{chainId,contractAddress,payoutAuthorizer,dao,daoDelaySeconds,defaultLockDuration}'
expected="0xff82f1ecC733bD59379D180C062D5aBa1ae7fa04"
if ! echo "${contract_json}" | jq -e --arg expected "${expected}" '.contractAddress|ascii_downcase == ($expected|ascii_downcase)' >/dev/null 2>&1; then
  echo "Unexpected contractAddress (expected ${expected})." >&2
  exit 1
fi

echo
echo "GET /id"
curl -s "${API_URL}/id?repo=octocat/Hello-World&issue=1" | jq '{repo,repoHash,issueNumber,bountyId}'

echo
echo "Smoke test OK."
