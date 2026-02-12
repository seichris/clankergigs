# /project:claim

Submit a claim for a bounty (API claim-auth + on-chain submitClaim).

## Required inputs (ask if missing)

- Bounty identifier:
  - Either `BOUNTY_ID` (0x… bytes32), or `REPO` + `ISSUE_NUMBER` to compute it
- PR URL: `https://github.com/<owner>/<repo>/pull/<n>`
- Claimer EOA address:
  - Prefer explicit `CLAIMER_EOA`
  - If the claimer is the current `PRIVATE_KEY`, you can derive it with `cast wallet address --private-key "$PRIVATE_KEY"` (do not print the private key)
- Network selection: ensure `API_URL`, `RPC_URL`, `CHAIN_ID`, `CONTRACT_ADDRESS` all match
- API auth token: `AUTH_TOKEN` (or `GITHUB_TOKEN` or `GHB_TOKEN`)

## Safety

- Do not print any auth token.
- Before the on-chain step, restate: network, `bountyId`, `claimer`, `prUrl`.

## Steps

```bash
set -euo pipefail

gh auth status
./scripts-for-ai-agents/01_health.sh

if [ -z "${BOUNTY_ID:-}" ]; then
  eval "$(./scripts-for-ai-agents/02_ids.sh "$REPO" "$ISSUE_NUMBER")"
fi

claim="$(./scripts-for-ai-agents/06_claim_auth.sh "$BOUNTY_ID" "$CLAIMER_EOA" "$PR_URL")"
nonce="$(echo "$claim" | jq -r .nonce)"
deadline="$(echo "$claim" | jq -r .deadline)"
sig="$(echo "$claim" | jq -r .signature)"

./scripts-for-ai-agents/07_submit_claim.sh "$BOUNTY_ID" "$PR_URL" "$nonce" "$deadline" "$sig"
```

## Output

- The tx hash from `submitClaimWithAuthorization(...)`.
