# Sui Hackathon Implementation Plan (gh-bounties)

This repo currently implements **GitHub issue bounties** on an EVM chain (Solidity + event indexer). This document is a plan for building a **Sui-native DeFi version** that can compete for:

- **Best Overall Project ($3,000)**: end-to-end product + strong execution across multiple dimensions
- **Notable Projects ($1,000 x up to 7)**: standout strength in one dimension (UX, creativity, technical design, etc.)

The goal is a working prototype/demo that shows why **Sui is uniquely suited** (PTBs, object model, composability, DeepBook, onboarding).

---

## Project Thesis: “Bounties as DeFi Escrow Primitives”

Turn a “GitHub bounty” into an on-chain **escrow vault** with:

- **Programmable Transaction Blocks (PTBs)** for “one-click” flows (swap + fund + lock + comment)
- **Object-based escrow** for parallelizable bounties and clean ownership/accounting
- **Composability** with DeFi (DeepBook swaps; optional yield while escrowed)
- Optional **sponsored transactions + zkLogin** so non-crypto GitHub devs can claim bounties

This makes the product a DeFi app (escrow + swaps/yield + composable flows), not only a web2 coordination tool.

---

## On-Chain Design (Move) — Minimal But Extensible

### Core objects

- `Repo`: represents a GitHub repo (keyed by a deterministic `repo_hash`), stores `admin`/rules.
- `RepoAdminCap`: capability object proving maintainer/admin rights for repo actions.
- `Bounty`: represents an issue bounty (repo_hash + issue_number + metadata_uri), status, and references to vault(s).
- `Vault<T>`: per-coin-type escrow vault for a bounty (holds a `Balance<T>`).
- `FundingReceipt`: per-funder receipt (amount, coin type, locked_until, bounty_id) to support refunds/position tracking.
- `Claim`: represents a claim (PR link or proof), claimer address, status.

### Events (indexer-friendly)

Emit events for:

- repo registration / admin change
- bounty created
- funded (with token type + amount + optional lock)
- claim submitted
- status changed
- payout / refund

### Key Sui-specific mechanics to lean on

- **PTBs**: batch “create bounty + fund + swap” into one atomic user action.
- **Shared objects (selectively)**: keep `Bounty` as an owned object when possible; use shared objects only where necessary (e.g., a global registry, DeepBook pools).
- **Dynamic fields / tables**: attach receipts, claims, and per-token vault references without huge structs.
- **SUI-native sponsorship**: enable gasless flows by having the backend sponsor the PTB.

---

## Off-Chain Components (Reuse What Exists)

### API / indexer

Adapt `apps/api` to index **Sui events** instead of EVM logs:

- backfill via `suix_queryEvents` (or Sui GraphQL)
- tail live events (websocket subscriptions if available; otherwise polling with checkpoints)
- store normalized rows in existing tables (`bounty`, `funding`, `claim`, `payout`, `refund`)
- keep GitHub automations (labels + issue comments) as-is, but triggered by Sui events

### Web app

- Replace wallet integration with Sui wallet adapter / dapp kit.
- Provide guided flows:
  - Create bounty (issue URL)
  - Fund bounty (choose coin; optionally “auto-swap to stable”)
  - Submit claim (PR URL)
  - Approve + payout (repo admin)
  - Refund (after lock expiry)

---

## Prize Strategy Options

Pick one “Best Overall” option or one “Notable” option. You can also mix, but scope control matters.

### Option A — Best Overall: “One-Click Multi-Asset Bounties”

Target: win **Best Overall** by being strong across UX + technical design + DeFi integration.

Core Sui differentiators:

- PTB “one click” flows
- DeepBook swap integration (fund in any supported coin, vault in a chosen base coin)
- sponsored tx / zkLogin for low-friction onboarding

MVP (must ship):

1. Move contracts: repo + bounty + fund (SUI) + claim + payout + refund
2. Indexer: displays bounties, totals, claims, payouts
3. Web demo: end-to-end user journey with clear UI states

Stretch (to stand out):

- DeepBook-powered swap inside the funding PTB (fund with Coin A, escrow Coin B)
- multi-asset vaults (support at least 2 coin types cleanly)
- gas sponsorship for claim submission (best UX moment)
- “batch payout” PTB (pay multiple winners or multiple bounties in one tx)

Demo script (2–3 minutes):

- Create bounty from a GitHub issue URL
- Fund with a non-base coin, show swap + escrow in one PTB
- Submit claim as a new user (zkLogin or sponsored tx)
- Approve + payout; show on-chain events and GitHub comment

### Option B — Notable (Technical): “DeepBook-Native Funding + Price Discovery”

Target: win a **Notable Project** by doing a standout DeepBook integration.

Idea:

- Funding happens in a “base coin” (e.g., stable), but users can contribute any supported coin:
  - PTB routes: swap -> escrow -> mint receipt
- Add an optional “limit fund” mode:
  - funder places a DeepBook limit order that, when filled, automatically routes proceeds into bounty escrow

Why it’s notable:

- DeepBook is Sui-native, and composing it into escrow flows is hard/interesting.
- Shows serious Move + DeFi composability work even if the rest is simple.

MVP:

- swap + fund PTB working on testnet
- indexer shows effective funded amount in base coin

### Option C — Notable (UX): “Gasless Claiming for GitHub Developers”

Target: win a **Notable Project** by delivering the best onboarding/user experience.

Idea:

- Let a developer claim a bounty with **zero tokens**:
  - authenticate via **zkLogin**
  - sign a PTB to submit claim
  - backend sponsors gas and submits tx

Why it’s notable:

- This is a uniquely Sui-friendly UX story (sponsored tx + zkLogin).
- Clear product insight: claimants are least likely to have gas.

MVP:

- zkLogin login flow
- sponsored claim transaction
- “claim submitted” shows up in UI + indexer

### Option D — Notable (Creative DeFi): “Escrow That Earns Yield (Safely)”

Target: win a **Notable Project** by creative DeFi mechanism design.

Idea:

- Escrowed funds can be deposited into a conservative yield source (e.g., a lending market) until payout/refund.
- Maintain strict safety constraints:
  - whitelist integration
  - always allow instant unwind for payout/refund
  - cap exposure per bounty

MVP:

- deposit + withdraw adapter module
- “escrow APY” display + accounting in indexer

---

## 7-Day Build Plan (Hackathon-Friendly)

Day 1: Move scaffolding + data model

- create package + modules
- implement `Repo` + `RepoAdminCap` + `Bounty` + events

Day 2: Funding + refund

- implement `Vault<SUI>` + `FundingReceipt` + lock time checks
- emit events; write basic tests

Day 3: Claims + payout

- implement `Claim` creation + status changes + payout
- batch payout PTB (optional but high leverage)

Day 4: Indexer (Sui events -> DB)

- backfill + tail events
- populate `bounty`, `funding`, `claim`, `payout`, `refund` tables

Day 5: Web flows

- connect wallet
- create/fund/claim/payout screens
- show on-chain state with clear “what happened” timelines

Day 6: Prize hook (choose one)

- DeepBook swap funding OR sponsored tx/zkLogin OR yield adapter

Day 7: Polish + demo + submission

- harden error states
- record demo + write clear submission narrative (“why Sui”)
- add diagrams and a short “how to run” section

---

## Submission Checklist (Maps to Prize Requirements)

- Built on Sui; meaningfully uses Sui-specific capabilities (PTBs, object model, composability, DeepBook, sponsorship/zkLogin).
- Working prototype:
  - deploy package on testnet/devnet
  - web UI demo
  - indexer showing live updates
- Clear problem statement:
  - “fund open-source work with on-chain escrow; pay out transparently; compose with DeFi”
- Strong execution in 2+ areas (for Best Overall):
  - UX: gasless claim / clean UI
  - Technical design: receipt + vault model, safety checks
  - Market insight: why bounties + DeFi makes sense
  - Creativity: DeepBook routing or yield-bearing escrow
- Path beyond hackathon:
  - repo onboarding, safer integrations, expansion to more bounties/workflows, partnerships

---

## Resources

- Get Started: https://docs.sui.io/guides/developer/getting-started
- Project Ideas: https://docs.google.com/document/d/1UFjTckWeGJf0OSGAP1MtMLQpYl6HqDQ7sMdUYziMMjI/edit?usp=sharing
- DeFi Resources: https://www.sui.io/defi
- Introduction to PTBs: https://docs.sui.io/guides/developer/sui-101/building-ptb
- DeepBook docs: https://docs.sui.io/standards/deepbook
- DeepBook repo: https://github.com/MystenLabs/deepbookv3

