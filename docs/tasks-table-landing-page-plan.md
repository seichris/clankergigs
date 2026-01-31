# Tasks Table Landing Page (Shadcn) - Implementation Plan

## Goal

Replace the current `apps/web` landing page with the shadcn "tasks" data table UI (search + filter + row actions), backed by real bounty/issue data:

- The table lists every GitHub issue that **currently has a bounty** or **had a bounty in the past** (1 row per issue/bounty).
- Top-right primary button (red) opens a modal to "Add issue / fund bounty".
- Each row includes an action to "Add funds" to that issue's bounty.
- Top-right profile avatar opens a menu (modeled after the shadcn tasks example).
- Modal must not open unless wallet is connected.

Reference UI:
- Shadcn Data Table docs: https://ui.shadcn.com/docs/components/radix/data-table
- Example to adapt: https://github.com/shadcn-ui/ui/tree/main/apps/v4/app/(app)/examples/tasks

## Non-goals (for first pass)

- Rebuilding the entire manual MVP actions currently on `apps/web/src/app/page.tsx` (claim submission, payout splitting UI, etc.). Those can move to secondary pages later.
- Historical GitHub side effects (labels/comments) beyond what the indexer already does.
- Perfect parity with GitHub issue metadata (title, labels, assignees) unless we explicitly add enrichment.

## UX / Page Layout

### Header (top bar)

Right side:
- Primary red button: `Add issue / fund bounty`
  - Disabled if wallet not connected.
  - On click:
    - If wallet not connected: do nothing (or show a toast explaining to connect wallet first).
    - If connected: open `FundIssueDialog`.
- Profile avatar + dropdown menu (shadcn `Avatar` + `DropdownMenu`)
  - Avatar uses GitHub OAuth user avatar (`GET /auth/me`) when available; fallback to an identicon / placeholder.
  - Menu items (MVP):
    - `Connect GitHub` or `Logout GitHub` (depending on auth state)
    - `Copy wallet address` (if wallet connected)
    - `Disconnect wallet` (optional; if we support it)

Main content:
- Shadcn tasks-like `DataTable` with search/filter toolbar.

### Fund Issue Modal (Dialog)

Triggered from:
- Top-right `Add issue / fund bounty` button (empty/default form).
- Row action `Add funds` (pre-filled with that issue URL / bounty identifiers).

Form fields (as requested):
- GitHub issue URL (input)
  - Example: `https://github.com/seichris/gh-bounties/issues/1`
  - Also display parsed label: `repo: github.com/seichris/gh-bounties • issue: #1`
- Derived (read-only preview):
  - `repoHash` (computed from `repoId`)
  - `bountyId` (computed from `repoHash` + `issueNumber`)
- Funding asset (select):
  - `ETH`
  - `ERC20 (USDC)` (use `usdcAddressForChainId(chainId)` from `@gh-bounties/shared`)
- Lock days (number input; default `7`)
- Amount (string/number input; validated; displayed with correct decimals)
- Submit button: `Fund Issue`

Validation / behavior:
- Validate issue URL via existing `parseGithubIssueUrl` (`apps/web/src/lib/gh.ts`).
- If ERC20 selected, ensure `usdcAddressForChainId` resolves for current chain; otherwise disable submit with a message.
- On submit:
  - If ERC20: ensure allowance then call fund.
  - If ETH: call fund with `value`.
  - Optimistically close dialog on tx submission; show toast + refresh table after confirmation (or after receipt).

## Data Model (What Each Row Should Contain)

The table is for "issues with bounties". In the current DB schema (`apps/api/prisma/schema.prisma`), the closest durable entity is `Bounty` + `metadataURI` (issue URL). For MVP, treat each `Bounty` as a row; display issue-derived fields by parsing `metadataURI`.

Recommended row shape (API -> web):

- Identifiers:
  - `issueUrl` (from `Bounty.metadataURI`)
  - `owner`, `repo`, `issueNumber` (parsed from `issueUrl`)
  - `repoHash` (from `Bounty.repoHash`)
  - `bountyId` (from `Bounty.bountyId`)
- Status:
  - `status` (from `Bounty.status` e.g. OPEN/IMPLEMENTED/CLOSED)
  - `createdAt`, `updatedAt`
- Funding / totals (aggregated from `BountyAsset`):
  - `assets[]`: `{ token, fundedWei, escrowedWei, paidWei }` (strings or bigints serialized)
  - Convenience fields for table display:
    - `totalFundedUsdLike` (optional later)
    - `fundedEth`, `fundedUsdc` (derived client-side if we keep only raw assets)
- Activity counts:
  - `fundingCount`
  - `claimerCount` / `claimCount`
  - `payoutCount`
  - `refundCount`

Optional enrichment (phase 2):
- GitHub issue `title`, `state`, `labels`, `assignees`, `updatedAt` (from GitHub API).

## API Work (apps/api)

### 1) Add a purpose-built listing endpoint for the table

Add `GET /issues` (name can vary) that returns a list of rows optimized for the table.

Why: `/bounties` currently returns either a single bounty with includes or a shallow list without assets. The table needs assets and counts, and we want stable sorting/filtering.

Proposed response:

```json
{
  "issues": [
    {
      "issueUrl": "https://github.com/seichris/gh-bounties/issues/1",
      "owner": "seichris",
      "repo": "gh-bounties",
      "issueNumber": 1,
      "repoHash": "0x...",
      "bountyId": "0x...",
      "status": "OPEN",
      "chainId": 31337,
      "contractAddress": "0x...",
      "createdAt": "2026-01-31T00:00:00.000Z",
      "updatedAt": "2026-01-31T00:00:00.000Z",
      "assets": [
        { "token": "0x0000000000000000000000000000000000000000", "fundedWei": "10000000000000000", "escrowedWei": "10000000000000000", "paidWei": "0" }
      ],
      "counts": { "fundings": 3, "claims": 1, "payouts": 0, "refunds": 0 }
    }
  ]
}
```

Implementation details:
- Query `Bounty.findMany` with `include: { assets: true, _count: { select: { fundings: true, claims: true, payouts: true, refunds: true } } }`.
- Parse `metadataURI` using existing regex logic (API already has `apps/api/src/github/parse.ts`).
- Support query params for table needs (optional but useful):
  - `q` (search string against owner/repo/issueNumber/issueUrl)
  - `status`
  - `token` (ETH vs USDC)
  - `take`/`cursor` for pagination (later; MVP can cap at 200)

### 2) Keep `/bounties` for single bounty detail / legacy UI

Don’t remove existing behavior; the table page will switch to `/issues`.

### 3) (Optional) GitHub enrichment endpoint

If we want real issue titles/states:
- Add a cached `GET /github/issue?url=...` that calls GitHub REST/GraphQL, using:
  - Authenticated session token if available, else unauthenticated (rate limits).
- Cache responses in DB (new table) or in-memory with TTL (MVP).

## Web Work (apps/web)

### 1) Add shadcn/ui + dependencies

In `apps/web`:
- Install shadcn v4 components + required deps (radix, tanstack table, class-variance-authority, tailwind-merge, etc.).
- Add shadcn `components.json` configured for:
  - `appDir: true`
  - `tailwind` (v4) + CSS variables theme
- Add the minimal shadcn primitives needed for the tasks example:
  - `button`, `input`, `badge`, `avatar`, `dropdown-menu`, `dialog`, `select`, `table`, `separator`, `checkbox` (and any others required by the example).

### 2) Replace landing page with the tasks table layout

Refactor `apps/web/src/app/page.tsx`:
- Replace the current "manual MVP" UI with a `TasksTablePage` component.
- Keep existing contract-call logic, but move it into:
  - `apps/web/src/lib/hooks/useWallet.ts` (wallet + chain state)
  - `apps/web/src/lib/hooks/useFundBounty.ts` (fund action + loading/toasts)
  - (or a single `useBountyActions` hook) to keep the page clean.

### 3) Port the shadcn tasks example structure (adapted)

Create a local feature folder (suggested):
- `apps/web/src/app/(app)/tasks/` (optional route-group) OR keep under `apps/web/src/components/` if you want `/` only.

Files to mirror from the shadcn example (names flexible):
- `apps/web/src/components/issues-table/data-table.tsx` (generic table)
- `apps/web/src/components/issues-table/columns.tsx` (Issue columns + actions)
- `apps/web/src/components/issues-table/toolbar.tsx` (search/filter)
- `apps/web/src/components/issues-table/types.ts` (IssueRow type)

### 4) Table columns (MVP)

Suggested columns (match "all info we have", but still readable):

- Issue:
  - Repo (`owner/repo`)
  - `#issueNumber`
  - Link icon to open `issueUrl`
- Status:
  - Bounty status badge (`OPEN`, `IMPLEMENTED`, `CLOSED`)
- Funding:
  - ETH totals (funded / escrowed / paid)
  - USDC totals (funded / escrowed / paid)
  - (or a single "Assets" column that renders a compact stacked view)
- Activity:
  - `fundings`, `claims`, `payouts`, `refunds` counts
- Updated:
  - `updatedAt` (relative + hover absolute)
- Actions:
  - Row actions menu (shadcn dropdown) with at least:
    - `Add funds` (opens modal prefilled)
    - `Copy bountyId`
    - `Copy repoHash`

### 5) Fetching data

Implement `GET ${NEXT_PUBLIC_API_URL}/issues` in the page (or via a small client function):
- Fetch with `credentials: "include"` to keep GitHub session behavior consistent (even if this endpoint doesn’t require it).
- Store rows in state; re-fetch after a successful funding tx receipt.
- For MVP, do client-side filtering/sorting/search (tanstack table handles this well).

### 6) FundIssueDialog implementation

Component responsibilities:
- Own the form state + validation.
- On open:
  - If opened from row: prefill `issueUrl`, compute `repoHash` and `bountyId`.
  - Else: start with default issue URL blank (or the example URL).
- On submit:
  - Call existing viem write flow (from today’s page) but extracted into a hook.
  - Handle ETH vs ERC20 approval.
- On success:
  - Close dialog
  - Toast "Submitted" + "Confirmed"
  - Refresh table data

Wallet gating:
- The dialog component should accept `walletAddress` and refuse to render/open if null.
- The button that triggers it should check wallet first.

### 7) Profile avatar + menu

Reuse existing GitHub session fetch (`GET /auth/me`) from `apps/web/src/app/page.tsx`, but move it into a small hook:
- `useGithubUser()` -> `{ user, login(), logout() }`

Header renders:
- `Avatar` using `userAvatarUrl` when present (API stores it in `GithubSession.userAvatarUrl`).
- Dropdown menu actions to login/logout.

## Incremental Delivery Steps

1) Add shadcn UI primitives + minimal styling theme for `apps/web`.
2) Drop in the tasks table example with mock data; confirm search/filter/actions UI works.
3) Add API `GET /issues` returning bounty-derived rows.
4) Wire table to real data; implement columns + row action menu.
5) Implement `FundIssueDialog` UI + validation; wire to existing funding logic (refactored into hooks).
6) Add top-right primary red button + wallet gating.
7) Add profile avatar dropdown menu + GitHub login/logout wiring.
8) Remove/retire old landing page UI (or move it to `/debug` / `/legacy` if still useful).

## Testing / Verification

Manual checks (local dev):
- `pnpm dev` loads `/` and renders the table.
- Search/filter changes visible rows as expected.
- Without wallet: the primary button is disabled and dialog cannot open.
- With wallet:
  - Funding ETH works and table reflects updated totals after confirmation.
  - Funding USDC handles approval + funding and updates totals.
- GitHub auth:
  - Avatar shows when logged in.
  - Menu can login/logout and the UI updates.

Quick repo checks:
- `pnpm typecheck`
- `pnpm lint`

## Open Questions (Decide Before Implementing)

- Should the table show GitHub issue title/state/labels (requires GitHub API calls/caching), or stay strictly on-chain + URL-derived for MVP?
- Should the "Add issue" flow *create* the bounty on-chain if it doesn’t exist yet, or only allow funding an existing bountyId?
  - The current modal spec implies funding, but an "Add issue" CTA usually means "create bounty" as well.
- Should USDC be the only ERC20 option for now, or do we want a generic token address input?
- Do we want pagination/server-side filtering for large datasets, or is `take <= 200` fine for MVP?

