#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <bounty_id>" >&2
  exit 1
fi

bounty_id="$1"

out="$("$(dirname "$0")/03_read_bounty.sh" "$bounty_id")"

# cast output varies by version/config (either one value per line or a single tuple-ish line).
# createdAt is the 4th return value of:
#   bounties(bytes32)(bytes32,uint256,uint8,uint64,string)
created_at="$(echo "$out" | sed -n '4p' | tr -cd '0-9')"
if [ -z "$created_at" ]; then
  created_at="$(echo "$out" | tr -d '()"' | tr ',' ' ' | awk '{for (i=1;i<=NF;i++) if ($i ~ /^[0-9]+$/) last=$i} END{print last}')"
fi

if [ -z "${created_at:-}" ]; then
  echo "Failed to parse createdAt from output:" >&2
  echo "$out" >&2
  exit 1
fi

echo "$created_at"

