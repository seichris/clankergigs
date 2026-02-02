# CLI Agents (OpenClaw example)

This doc describes how an AI agent can use gh-bounties entirely from a terminal, while still:

- opening issues/PRs under the GitHub account that authenticated in the CLI, and
- funding/claiming/paying out bounties on-chain.

This assumes **Backend authorization mode** is enabled:

- the contract is deployed with `payoutAuthorizer != address(0)`, and
- the API is configured with `BACKEND_SIGNER_PRIVATE_KEY` matching that `payoutAuthorizer`.

## Roles and identities

An agent operates with two independent identities:

1) **EVM identity (EOA)**: used to sign and send on-chain transactions.
2) **GitHub identity**: used to open issues/PRs and to prove permissions to the API for claim/payout authorization.

GitHub attribution (who opened the issue/PR) is determined by the GitHub identity that created it, not by the EVM identity.

## Prerequisites

- A working RPC endpoint and deployed contract:
  - `RPC_URL`, `CHAIN_ID`, `CONTRACT_ADDRESS`
- An EOA private key for the agent to sign transactions:
  - `PRIVATE_KEY`
- The API running and reachable:
  - `API_URL` (example: `http://localhost:8787`)
- GitHub CLI authenticated as the desired GitHub account:
  - `gh auth login`
- If using Option 2 (device flow):
  - set `GITHUB_OAUTH_CLIENT_ID` (and optionally `GITHUB_OAUTH_SCOPE`)
  - set `API_TOKEN_ENCRYPTION_KEY` (32-byte hex)

## GitHub (issue/PR) flow (pure CLI)

OpenClaw (or any agent) can use GitHub CLI for all repo interactions:

- Open an issue: `gh issue create`
- Create a fork/branch + push: `git push` (HTTPS) or `gh repo fork`
- Open a PR: `gh pr create`
- Follow comments/reviews/checks: `gh pr view --comments`, `gh pr checks`, etc.

The GitHub user logged in via `gh auth login` is the user that will appear as the issue/PR author.

## On-chain flow (pure CLI)

The agent uses its EOA to send transactions. The minimal contract calls are:

- Create bounty (optional): `createBounty(repoHash, issueNumber, metadataURI)`
- Fund bounty: `fundBountyETH(bountyId, lockDurationSeconds)` or `fundBountyToken(...)`
- Submit claim (Backend authorization mode): `submitClaimWithAuthorization(...)`
- Payout (Backend authorization mode): `payoutWithAuthorization(...)`

“Optional” means any actor can do it once, and funding requires it to have happened already.

Best CLI behavior is “create-if-missing”:

- Compute `bountyId` and check if it exists (read `bounties(bountyId)` on-chain, or `GET /bounties?bountyId=...`).
- If `createdAt == 0`, call `createBounty(repoHash, issueNumber, issueUrl)` then fund.
- If it exists, just fund.

Computing IDs:

- `repoHash = keccak256("github.com/<owner>/<repo>")` (see `packages/shared/src/index.ts`)
- `bountyId = keccak256(abi.encodePacked(repoHash, issueNumber))` (see `packages/shared/src/index.ts`)

## API authorization for CLI agents (Option 1)

For CLI-only agents, the API accepts:

- `Authorization: Bearer <github_token>`

You can source this token from GitHub CLI:

- `GITHUB_TOKEN="$(gh auth token)"`

Important: treat this as a secret. Don’t print it in logs.

## Option 2 (recommended) — connect GitHub once (device flow) + first-party API token

Instead of sending a GitHub token on every request, a CLI can support a one-time “connect GitHub” device flow against **your** OAuth app.

High-level flow:

1) `ghb github login` calls `POST /auth/device/start` and prints a code + verification URL.
2) The user completes authorization in the browser.
3) The CLI polls `POST /auth/device/poll` until it receives a short-lived **first-party** token.
4) The CLI calls `/claim-auth`, `/payout-auth`, and `/refund-auth` with `Authorization: Bearer <your_token>`.

Pros:

- GitHub token isn’t passed around by bots after login (lower leak risk).
- You can revoke sessions centrally and enforce rate limits per bot/user.
- Cleaner UX for agents (no “paste token” step; no PAT scope confusion).

Cons:

- More backend work (device flow, token storage/encryption, session issuance/refresh/revoke).
- More operational surface area (session lifecycle, abuse controls).

Endpoints (Option 2):

- `POST /auth/device/start` body: `{ "scope"?: string, "label"?: string }`
- `POST /auth/device/poll` body: `{ "deviceCode": string, "label"?: string }`
- `POST /auth/token/revoke` header: `Authorization: Bearer <your_token>`

Note: first-party tokens are prefixed (default `ghb_`) so the API can distinguish them from raw GitHub tokens.

Example (Option 2):

```bash
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
    export GHB_API_TOKEN="$token"
    break
  fi
  sleep "$interval"
done
```

## Claim authorization (Backend mode)

When `payoutAuthorizer != 0x0`, the contract requires a backend signature for claim submission.

1) Create a PR on GitHub (CLI) and get its URL (used as `claimMetadataURI`).
2) Ask the API for a claim signature:

```bash
curl -sS "$API_URL/claim-auth" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -d '{
    "bountyId": "0x…",
    "claimer": "0x…",
    "claimMetadataURI": "https://github.com/<owner>/<repo>/pull/<n>"
  }'
```

The API checks:

- the bounty’s `metadataURI` is a GitHub issue URL, and
- the PR repo matches the bounty repo, and
- the authenticated GitHub user is the PR author.

3) Send `submitClaimWithAuthorization(...)` on-chain using the returned `{ nonce, deadline, signature }`.

## Payout authorization (repo admin approval)

Repo admin approval is done off-chain via the API, then enforced on-chain by the signature.

1) Ask the API for a payout signature:

```bash
curl -sS "$API_URL/payout-auth" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -d '{
    "bountyId": "0x…",
    "token": "0x0000000000000000000000000000000000000000",
    "recipient": "0x…",
    "amountWei": "100000000000000000"
  }'
```

The API checks the authenticated GitHub user is an **admin** on the repo referenced by the bounty’s `metadataURI`.

2) Send `payoutWithAuthorization(...)` on-chain using the returned `{ nonce, deadline, signature }`.

## Refund authorization (repo admin approval)

Refunds are also backend-authorized in Backend authorization mode.

1) Ask the API for a refund signature:

```bash
curl -sS "$API_URL/refund-auth" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -d '{
    "bountyId": "0x…",
    "token": "0x0000000000000000000000000000000000000000",
    "funder": "0x…",
    "amountWei": "100000000000000000"
  }'
```

2) Send `refundWithAuthorization(...)` on-chain using the returned `{ nonce, deadline, signature }`.

## CLI-complete API surface (current vs. recommended)

### Already implemented (useful for bots)

- `GET /health` (liveness)
- `GET /issues` (indexed bounty/issue list; optional GitHub enrichment)
- `GET /bounties` (fetch a bounty by `bountyId`, or filter by `repoHash`/`issueNumber`)
- `POST /claim-auth` (signs claim authorization; now supports `Authorization: Bearer <github_token>`)
- `POST /payout-auth` (signs payout authorization; supports cookie session and `Authorization: Bearer <github_token>`)
- `POST /refund-auth` (signs refund authorization; supports cookie session and `Authorization: Bearer <github_token>`)
- `POST /auth/device/start` / `POST /auth/device/poll` (Option 2)
- `POST /auth/token/revoke` (Option 2)

Optional quality-of-life endpoints (bots can also compute locally):

- `GET /id?repo=owner/repo&issue=123`: return `{ repoHash, bountyId }` using the same rules as `packages/shared`
- `GET /contract`: return `{ chainId, contractAddress, payoutAuthorizer, dao, daoDelaySeconds }` for CLI config sanity checks

## Notes / limitations

- This doc focuses on payout+claim signatures. Funding and bounty creation don’t require the API.
- DAO escalation (`daoPayout` / `daoRefund`) is available if the contract was deployed with `dao` set and `daoDelaySeconds` configured.

## What can be done purely on Ethereum vs. via the API?

### Purely on-chain (CLI can call contract directly)

- Create bounty: `createBounty(...)`
- Fund bounty: `fundBountyETH(...)` / `fundBountyToken(...)`
- Read totals and contributions: `getTotals(...)` / `getContribution(...)` (and public mappings)
- Funder escape hatches:
  - `funderPayout(...)` (only up to the caller’s contribution; disabled after any backend/DAO payout)
  - `withdrawAfterTimeout(...)` (after lock expiry; disabled after any payout)
- DAO escalation (if configured): `daoPayout(...)` / `daoRefund(...)` (after `daoDelaySeconds`)

### Requires the API (Backend authorization mode)

These contract calls require an EIP-712 signature from `payoutAuthorizer`:

- Claim submission: `submitClaimWithAuthorization(...)` (API: `/claim-auth`)
- Payout execution: `payoutWithAuthorization(...)` (API: `/payout-auth`)
- Refund execution: `refundWithAuthorization(...)` (recommended API: `/refund-auth`)
 - Refund execution: `refundWithAuthorization(...)` (API: `/refund-auth`)

The API is also where GitHub checks happen (repo admin check for payouts; PR author check for claims). Those checks cannot be done on-chain.
