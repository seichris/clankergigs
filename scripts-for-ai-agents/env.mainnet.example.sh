#!/usr/bin/env bash
set -euo pipefail

# Copy this file to env.mainnet.sh (do not commit secrets) and fill in values.
# Then run: source ./scripts-for-ai-agents/env.mainnet.sh

export API_URL="https://api.clankergigs.com"
export RPC_URL="https://eth-mainnet.g.alchemy.com/v2/<key>"
export CHAIN_ID=1
export CONTRACT_ADDRESS="<MAINNET_CONTRACT_ADDRESS>"

# Required for on-chain transactions (fund/create/claim/payout):
# export PRIVATE_KEY="0x..."

# API auth (pick one):
# Option 1 (CLI-only): pass a GitHub token to the API on each request.
# export GITHUB_TOKEN="$(gh auth token)"
#
# Option 2 (recommended): device-flow token issued by the API you point at via API_URL.
# export GHB_TOKEN="ghb_..."

