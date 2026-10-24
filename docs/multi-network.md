# One API and database for multiple deployments

Set `NETWORKS_JSON` on the API. Each entry identifies one `(chainId, contractAddress)` pair:

```sh
NETWORKS_JSON='[{"chainId":1,"contractAddress":"0xff82f1ecC733bD59379D180C062D5aBa1ae7fa04","rpcUrls":["https://your-mainnet-rpc.example"],"publicRpcUrls":["https://ethereum-rpc.publicnode.com"],"name":"Ethereum"},{"chainId":11155111,"contractAddress":"0xff82f1ecC733bD59379D180C062D5aBa1ae7fa04","rpcUrls":["https://your-sepolia-rpc.example"],"publicRpcUrls":["https://ethereum-sepolia-rpc.publicnode.com"],"name":"Sepolia"}]'
```

Replace the server RPC placeholders with your providers. Addresses are normalized to lowercase. Duplicate pairs, invalid addresses, non-HTTP(S) URLs and missing server RPCs fail startup. Multiple contracts on the same chain are supported. Empty/unset `NETWORKS_JSON` retains `CHAIN_ID`, `CONTRACT_ADDRESS`, `RPC_URL` and the Ethereum-specific RPC fallbacks. `NETWORKS_JSON=[]` explicitly disables indexing. An unconfigured contract still allows the API to boot.

`startBlock` is optional per entry, falling back to `INDEXER_START_BLOCK`. Set it to the actual deployment block when indexing a fresh database; otherwise the existing development default starts at head minus 2,000 blocks. Existing deployment checkpoints take precedence. Each deployment has its own indexer, RPC chain/code checks and retry loop, so one unavailable RPC does not prevent other networks from indexing. Watcher notifications and a 30-second poll both trigger ordered catch-up from the last complete block.

`BACKEND_SIGNER_PRIVATE_KEY` remains shared. Its address must be the `payoutAuthorizer` on every configured contract. GitHub login, PR-author and repository-admin checks remain required.

## API behavior

- `GET /networks` returns `{ networks: [{ chainId, contractAddress, name?, publicRpcUrls }] }`. Server `rpcUrls`, credentials and transports are never returned.
- `GET /issues` and `GET /bounties` list all **configured** deployments when no network filters are supplied, retaining their existing result limits. Results include `chainId` and `contractAddress`.
- Either read filter may narrow the list, e.g. `/issues?chainId=1`, or provide the full pair: `/bounties?bountyId=0x…&chainId=1&contractAddress=0x…`.
- Looking up a bounty ID with multiple matches returns HTTP **409**, including when a chain-only filter still matches two contracts. Unknown or malformed network filters return **400**.
- `POST /claim-auth`, `/payout-auth` and `/refund-auth` accept `chainId` and `contractAddress` alongside their existing fields. Both are required when multiple networks are configured. Omission remains compatible for one configured network; partial selection is rejected. The selected RPC is checked against its chain ID before on-chain reads and signing. Responses also identify the selected pair.
- `GET /contract` accepts the same pair as query parameters and reads that deployment's contract metadata. It no longer returns the private server RPC URL.
- `GET /github/admin` uses network filters and rejects ambiguous bounty IDs. PR webhook/backfill linking covers every matching configured deployment, while the GitHub reminder remains one comment per PR.

Example request body (retain your normal GitHub authentication):

```json
{
  "chainId": 1,
  "contractAddress": "0xff82f1ecc733bd59379d180c062d5aba1ae7fa04",
  "bountyId": "0x…",
  "claimer": "0x…",
  "claimMetadataURI": "https://github.com/owner/repo/pull/123"
}
```

CLI clients using a multi-network API must include the pair in requests. Existing single-network scripts remain compatible.

## Web configuration

Set `NEXT_PUBLIC_API_URL` to the one API and `WEB_ORIGIN` to the one web origin. The web app fetches `/networks`, persists `ghb-network` in localStorage, and includes the pair in reads and authorization requests. Bounty detail links carry both query parameters and override saved selection; an unavailable deployment produces an error rather than selecting a different one. The selector distinguishes multiple contracts on the same chain. Changing selection resets the displayed bounty and open dialogs.

`publicRpcUrls` is an explicit, public browser RPC allowlist: do not put private provider credentials there. When absent, the browser uses the existing chain-specific `NEXT_PUBLIC_RPC_URLS_ETHEREUM_*` configuration, then viem's Ethereum/Sepolia public endpoints. The generic `NEXT_PUBLIC_RPC_URL` applies only to `NEXT_PUBLIC_CHAIN_ID` (default 31337). Custom chains require an appropriate public browser RPC. `NEXT_PUBLIC_CONTRACT_ADDRESS` and cross-origin network switching are no longer used.

Before a write, the wallet is prompted to switch to the selected chain. Every send checks the current wallet chain and the captured UI selection. Switching deployment cancels subsequent sends from an in-progress multi-step flow, including switching away and back. A request already handed to the wallet cannot be recalled; users should reject any outstanding wallet prompt before switching tasks. Transactions already confirmed remain on their original chain.

## SQLite upgrade

1. Stop the old API/indexers and take a consistent SQLite backup, including WAL contents if applicable. Test the migration on a copy first.
2. Install dependencies, then run `pnpm --filter @gh-bounties/api prisma:migrate:deploy` with the intended `DATABASE_URL`. This must precede starting the new API.
3. Build/regenerate the Prisma client with `pnpm --filter @gh-bounties/api build`.
4. Configure the registry and start the API and updated web app. Check `/networks`, `/contract` per pair, indexer startup logs and filtered bounty totals.

The migration rebuilds the six child tables and backfills `bountyDbId` from the previously unique on-chain bounty ID in one transaction. It keeps `Bounty.id`, child IDs, original amounts, timestamps and scalar `bountyId` fields. Orphan children fail migration instead of disappearing. Back up before retrying any failed migration; Prisma may require resolving the failed migration after the underlying data problem is corrected.

Bounty uniqueness is `(bountyId, chainId, contractAddress)`. Assets, claims, PR links and event deduplication are scoped to the parent database ID. Funding/payout/refund records and their balance adjustments commit together. Repository identity remains global, while `RepoDeployment` stores network-specific maintainer authority; the old `Repo.maintainerAddress` is a preserved legacy snapshot, not a current cross-network authority source.

This migration upgrades one database. It does not merge two previously independent databases or import data from a second stack. Keep that second database backed up and index its deployment from its actual deployment block into the unified database if needed.

Rollback requires restoring the backup and the old application together; the old Prisma client cannot safely write the new multi-network schema.
