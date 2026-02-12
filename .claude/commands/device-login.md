# /project:device-login

Get a first-party API token (Option 2 device flow) and export it as `GHB_TOKEN`, without printing it.

## Required inputs (ask if missing)

- `API_URL` (must match the network you intend to use)

## Safety

- Do not echo `GHB_TOKEN`.
- Store `GHB_TOKEN` only in your shell session (or a local, uncommitted env file).

## Steps

```bash
set -euo pipefail

start="$(curl -sS "$API_URL/auth/device/start" -H "Content-Type: application/json" -d '{}')"
deviceCode="$(echo "$start" | jq -r .deviceCode)"
userCode="$(echo "$start" | jq -r .userCode)"
verificationUri="$(echo "$start" | jq -r .verificationUri)"
interval="$(echo "$start" | jq -r .interval)"

echo "Go to: $verificationUri"
echo "Enter code: $userCode"

while true; do
  poll="$(curl -sS "$API_URL/auth/device/poll" -H "Content-Type: application/json" -d "{\"deviceCode\":\"$deviceCode\"}")"
  token="$(echo "$poll" | jq -r '.token // empty')"
  if [ -n "$token" ]; then
    export GHB_TOKEN="$token"
    break
  fi
  sleep "$interval"
done

# confirm token is present without printing it
test -n "${GHB_TOKEN:-}"
```

