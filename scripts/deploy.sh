#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="${ROOT_DIR}/contracts"

RPC_URL="${RPC_URL:?set RPC_URL}"
PRIVATE_KEY="${PRIVATE_KEY:?set PRIVATE_KEY}"

CHAIN_ID_HEX="$(curl -s -X POST "${RPC_URL}" -H "content-type: application/json" --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | jq -r '.result')"
if [[ -z "${CHAIN_ID_HEX}" || "${CHAIN_ID_HEX}" == "null" ]]; then
  echo "failed to fetch chain id from RPC_URL" 1>&2
  exit 1
fi

CHAIN_ID="$((CHAIN_ID_HEX))"

pushd "${CONTRACTS_DIR}" >/dev/null

forge script script/Deploy.s.sol:Deploy \
  --rpc-url "${RPC_URL}" \
  --broadcast \
  --private-key "${PRIVATE_KEY}" \
  >/dev/null

RUN_JSON="$(ls -1t "broadcast/Deploy.s.sol/${CHAIN_ID}/run-"*.json | head -n 1)"
ADDR="$(jq -r '.transactions[] | select(.contractName=="GHBounties") | .contractAddress' "${RUN_JSON}" | tail -n 1)"

popd >/dev/null

echo "${ADDR}"

