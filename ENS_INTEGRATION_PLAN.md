# ENS Integration Plan (Hackathon)

Goal: add a visible, user-facing ENS feature (beyond wallet connect UI) that improves the GH Bounties experience and qualifies for the ENS pool prize.

This plan is intentionally scoped to **apps/web** so it can ship quickly and be demo-ready.

---

## What we’re building

### 1) ENS-aware wallet identity (display)

When a wallet is connected, show:
- Primary ENS name (reverse record), falling back to a short `0x…` address.
- ENS avatar (if set), falling back to a generic placeholder.

Where:
- Header “Connect wallet” button on `apps/web/src/app/page.tsx`.

Why it’s good for demo:
- Immediately visible to judges.
- Clearly “ENS-specific” (reverse resolution + avatar record parsing).

### 2) ENS-aware payouts (input + resolution)

Allow the payout recipient field to accept either:
- a hex address (`0x…`), or
- an ENS name (ex: `alice.eth`)

Behavior:
- If user types an ENS name, resolve it to an address on mainnet and show the resolved address in the UI.
- Use the resolved address when calling `payout-auth` and sending the on-chain payout transaction.

Where:
- `apps/web/src/components/payout-dialog.tsx`

Why it’s good for demo:
- Functional ENS utility (not just cosmetic).
- Easy to show end-to-end: type `vitalik.eth` → see resolved recipient address → submit payout.

### 3) (Optional, “creative”) ENS ↔ GitHub trust signal

If the connected wallet has an ENS name with a `com.github` text record that matches the connected GitHub username, show a small “verified” badge.

Where:
- Header next to the connected wallet identity.

Why it’s good for demo:
- Uses ENS text records in a relevant way for a GitHub-integrated product.

---

## Technical design

### ENS chain + RPC

ENS data is primarily on Ethereum mainnet. Even if bounties run on Sepolia/local, ENS reads should use:
- chain: `mainnet`
- RPC: `NEXT_PUBLIC_ENS_RPC_URL` (new, optional)
- fallback RPC: `https://cloudflare-eth.com` (public, rate-limited; fine for hackathon demo)

### Implementation approach (no new deps)

Use existing `viem` (already in the repo) and its ENS actions:
- `getEnsName` (reverse resolve address → primary name)
- `getEnsAddress` (resolve ENS name → address)
- `getEnsAvatar` (read and parse avatar text record)
- `getEnsText` (read `com.github`)
- `normalize` (UTS-46 normalization for ENS names)

Add small React hooks to wrap these actions and handle:
- loading state
- error state
- cancellation on unmount

---

## Work breakdown

### Phase A — plumbing + hooks
1. Add `NEXT_PUBLIC_ENS_RPC_URL` to `apps/web/.env.local.example`.
2. Add `apps/web/src/lib/ens.ts`:
   - `getEnsPublicClient()` (mainnet client)
   - `isProbablyEnsName(input)` helper
   - `normalizeGithubUsername(textRecord)` helper
3. Add `apps/web/src/lib/hooks/useEns.ts`:
   - `useEnsPrimaryName(address)`
   - `useEnsAvatarUrl(name)`
   - `useEnsTextRecord(name, key)`
   - `useEnsAddressForName(name)`

### Phase B — UI integration
4. Update `apps/web/src/app/page.tsx`:
   - show ENS name + avatar for connected wallet
   - show optional “ENS ↔ GitHub” badge when `com.github` matches logged-in GitHub username
5. Update `apps/web/src/components/payout-dialog.tsx`:
   - accept `alice.eth` in recipient input
   - show resolution hint (“Resolves to 0x…”) and use resolved address for payout

---

## Acceptance criteria (demo-ready)

- Header shows ENS name if available (e.g. `wevm.eth`) and falls back to `0x1234…abcd`.
- Header shows ENS avatar when set.
- Payout dialog accepts either `0x…` or `name.eth`.
- If recipient is ENS:
  - UI shows resolved address (or a helpful “not found” message).
  - Transactions use the resolved address.
- No breaking changes to existing funding/claim flows.

---

## Demo script (60 seconds)

1. Connect wallet that has an ENS reverse record + avatar.
2. Show header updating to `name.eth` + avatar.
3. Open any issue row → Payout → paste `vitalik.eth`.
4. Show “Resolves to 0x…” and submit payout.
5. (Optional) If `com.github` matches: show “ENS ↔ GitHub verified”.

