# One API, one SQLite database, multiple deployments

`NETWORKS_JSON` takes precedence over the legacy API configuration:

```dotenv
NETWORKS_JSON='[{"chainId":1,"contractAddress":"0xff82f1ecC733bD59379D180C062D5aBa1ae7fa04","rpcUrls":["https://YOUR_MAINNET_RPC"],"startBlock":YOUR_MAINNET_DEPLOYMENT_BLOCK},{"chainId":11155111,"contractAddress":"0xff82f1ecC733bD59379D180C062D5aBa1ae7fa04","rpcUrls":["https://YOUR_SEPOLIA_RPC"],"startBlock":YOUR_SEPOLIA_DEPLOYMENT_BLOCK}]'
```

Replace the RPC and block placeholders before use. Contract addresses are normalized
to lowercase. Duplicate `(chainId, contractAddress)` pairs, empty lists and invalid
preferred configuration fail startup; they do not silently fall back to another chain.
Different contracts on the same chain are supported.

When `NETWORKS_JSON` is unset or blank, `CHAIN_ID`, `CONTRACT_ADDRESS`,
`RPC_URL` / `RPC_URLS_ETHEREUM_*` and `INDEXER_START_BLOCK` still configure one
deployment. No contract means a read-only API with no configured deployments.

Each deployment gets its own client, ordered indexer and checkpoint. Its RPC chain
ID and deployed bytecode are checked before indexing. Specify the deployment block
for **every newly added deployment**: the legacy head-minus-2000 default can miss a
bounty's creation event. A missing parent stops that indexer's range, rather than
attaching an event to a bounty from another chain.

## Upgrade an existing database

1. Stop the old API/indexer and take a consistent SQLite backup (including any WAL
   contents, using SQLite's backup command). Test the upgrade against a copy first.
   Do not run old and new binaries against the same database.
2. Install the locked dependencies, then generate the client and apply migrations:

   ```sh
   pnpm install --frozen-lockfile
   pnpm --filter @gh-bounties/api prisma:generate
   pnpm --filter @gh-bounties/api prisma:migrate:deploy
   ```

   Keep `DATABASE_URL` pointed at the intended existing database. SQLite relative
   paths resolve relative to the Prisma schema, so an absolute `file:/...` URL is
   convenient for production upgrades.

3. Migration `20261024000000_multi_network` runs the backfill and table rebuild in
   **one transaction**. It preserves each original child row and its ID, adds a
   non-null `bountyDbId` referencing `Bounty.id`, and removes the global bounty-ID
   uniqueness only after the children are rebound. Orphan children cause failure
   and rollback instead of being silently discarded. Contract-address casing is
   normalized in bounties and checkpoints. A normalization collision also fails
   rather than merging potentially conflicting state.
4. `Repo` retains GitHub identity and the legacy maintainer value for compatibility;
   `RepoDeployment` stores authority per deployment. Existing repo/deployment pairs
   with bounties inherit the legacy value. Registrations without any bounty have no
   historical network association in the old schema: replay that deployment from
   its creation block to reconstruct them. Replaying known events is idempotent.
5. Configure the registry and restart the API. Existing checkpoints are preserved;
   startup replays their last block because the old indexer checkpointed individual
   events. New checkpoints advance only after every event in a range succeeds.
   Funding/payout/refund inserts and aggregate changes are atomic, so interrupted
   ranges can be retried without double counting.
6. Check `/networks`, then `/issues?chainId=...&contractAddress=...` for each
   deployment. Check a bounty's assets and child records against its chain. Retain
   the backup until this verification is complete. Rolling back to old code
   requires restoring the old database backup too; the old schema cannot represent
   colliding cross-chain bounty IDs.

The migration does not merge multiple previously independent SQLite databases.
Upgrade one database and index additional deployments from their deployment blocks.
The indexer continues to follow the latest head; this change does not add a reorg
rollback/finality mechanism.

## API contract

- `GET /networks` returns `{ networks: [{ chainId, contractAddress }] }`. Server RPC
  URLs and provider credentials are never included.
- `GET /issues` and `GET /bounties` return all stored deployments when filters are
  omitted. Every row carries `chainId` and `contractAddress`. To filter, supply
  **both** parameters; partial/invalid pairs return `400`, unconfigured pairs `404`.
- `GET /bounties?bountyId=...` returns `409` when more than one stored deployment
  matches. Add both network parameters to disambiguate. The detail response and
  its children all belong to that deployment's database ID.
- `GET /contract` requires a pair when more than one deployment is configured.
- `POST /claim-auth`, `/payout-auth`, `/refund-auth` accept `chainId` and
  `contractAddress` in the JSON body. Omitted pairs are inferred only from a unique
  indexed bounty, or from the sole configured deployment when not yet indexed.
  Ambiguous or unresolved multi-deployment requests return `409`. A partial pair
  is never inferred. GitHub authentication and authorization remain required.
- Before signing, the API checks the selected RPC's chain and the selected
  contract's `payoutAuthorizer`. The existing `BACKEND_SIGNER_PRIVATE_KEY` must be
  the authorizer on each deployment for which it issues signatures; a mismatch
  returns `503`. Nonces and bounty state are read from that same client, and both
  chain ID and verifying contract are bound in the EIP-712 domain.
- GitHub PR webhooks and PR backfills link a referenced issue to every matching
  deployment using its `Bounty.id`; the existing reminder marker deduplicates the
  GitHub comment.

## One web origin

The web app fetches `/networks`, persists the selected **chain and contract** in
`localStorage`, and includes that pair in detail links, list queries and all
authorization requests. An unavailable saved/link target requires a new selection;
it never silently sends a transaction to another deployment. A discovery failure
leaves writes unavailable. Empty lists no longer display synthetic funded rows.

Server RPCs are private. Browser RPCs must be explicitly public:

```dotenv
NEXT_PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_NETWORK_RPC_URLS_JSON={"1":["https://YOUR_PUBLIC_MAINNET_RPC"],"11155111":["https://YOUR_PUBLIC_SEPOLIA_RPC"]}
```

The existing `NEXT_PUBLIC_RPC_URLS_ETHEREUM_MAINNET/SEPOLIA` (and singular aliases)
still work; otherwise Ethereum and Sepolia use viem's public defaults. The legacy
`NEXT_PUBLIC_RPC_URL` applies only to `NEXT_PUBLIC_CHAIN_ID`, preventing a Sepolia
fallback from accidentally being reused for mainnet. Other chains need an entry
in the public RPC map or a matching legacy RPC. Never put secret provider keys in
`NEXT_PUBLIC_*` variables. `NEXT_PUBLIC_CONTRACT_ADDRESS` is no longer used for
transactions; the API registry is authoritative. Separate web-origin variables no
longer drive the network selector.

Every contract write, including later steps of approve/fund or multiple payouts,
checks that its selection is still current, switches the injected wallet if
necessary, and rechecks the wallet chain. Rejected/ignored switches fail before
sending. A network/contract selection change cancels pending operations, including
changing A → B → A while an async request is outstanding.

## Checks

```sh
pnpm --filter @gh-bounties/api build
pnpm --filter @gh-bounties/api test
python3 -B apps/api/test/migration_test.py
pnpm --filter @gh-bounties/web typecheck
pnpm --filter @gh-bounties/web build
```

Tests use an isolated temporary SQLite database, deterministic test-only signing
key, mocked RPC/GitHub responses and an injected mock wallet. They never broadcast
a transaction or use real GitHub credentials. Python 3 is needed for the SQLite
fixture setup (override its executable with `PYTHON` if necessary).
