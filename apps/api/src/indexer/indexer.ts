import { getPrisma } from "../db.js";
import { ghBountiesAbi } from "./abi.js";
import { createPublicClient, fallback, http, isAddress, formatUnits, type Hex } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { syncBountyLabels } from "../github/labels.js";
import { postIssueCommentIfMissing } from "../github/comments.js";
import { parseGithubIssueUrl } from "../github/parse.js";
import type { GithubAuthConfig } from "../github/appAuth.js";

type IndexerConfig = {
  rpcUrls: string[];
  chainId: number;
  contractAddress: Hex;
  github?: GithubAuthConfig | null;
  backfillBlockChunk?: number;
  startBlock?: number;
};

type PublicClient = ReturnType<typeof createPublicClient>;

const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";

const erc20MetaAbi = [
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }]
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }]
  }
] as const;

const tokenMetaCache = new Map<string, { decimals: number; symbol: string | null }>();

async function getTokenMeta(client: PublicClient, token: string) {
  if (token === NATIVE_TOKEN) return { decimals: 18, symbol: "ETH" };
  if (tokenMetaCache.has(token)) return tokenMetaCache.get(token)!;

  let decimals = 18;
  let symbol: string | null = null;
  try {
    decimals = Number(
      (await client.readContract({
        address: token as Hex,
        abi: erc20MetaAbi,
        functionName: "decimals"
      })) as any
    );
  } catch {
    decimals = 18;
  }

  try {
    const res = (await client.readContract({
      address: token as Hex,
      abi: erc20MetaAbi,
      functionName: "symbol"
    })) as any;
    if (typeof res === "string" && res.length > 0) symbol = res;
  } catch {
    symbol = null;
  }

  const meta = { decimals, symbol };
  tokenMetaCache.set(token, meta);
  return meta;
}

function statusFromEnum(v: number): "OPEN" | "IMPLEMENTED" | "CLOSED" {
  if (v === 0) return "OPEN";
  if (v === 1) return "IMPLEMENTED";
  return "CLOSED";
}

async function bumpAssetTotals(prisma: any, bountyId: Hex, token: string, delta: { funded?: bigint; escrowed?: bigint; paid?: bigint }) {
  const existing = await prisma.bountyAsset.findUnique({
    where: { bountyId_token: { bountyId, token } }
  });
  const funded0 = BigInt(existing?.funded ?? "0");
  const escrow0 = BigInt(existing?.escrowed ?? "0");
  const paid0 = BigInt(existing?.paid ?? "0");

  const funded = funded0 + (delta.funded ?? 0n);
  const escrowed = escrow0 + (delta.escrowed ?? 0n);
  const paid = paid0 + (delta.paid ?? 0n);

  await prisma.bountyAsset.upsert({
    where: { bountyId_token: { bountyId, token } },
    create: { bountyId, token, funded: funded.toString(), escrowed: escrowed.toString(), paid: paid.toString() },
    update: { funded: funded.toString(), escrowed: escrowed.toString(), paid: paid.toString() }
  });
}

function eventMarker(cfg: IndexerConfig, eventName: string, txHash: string, logIndex: number) {
  return `ghb:${cfg.chainId}:${cfg.contractAddress.toLowerCase()}:${eventName}:${txHash.toLowerCase()}:${logIndex}`;
}

export async function startIndexer(cfg: IndexerConfig) {
  const prisma = getPrisma();
  if (!isAddress(cfg.contractAddress)) throw new Error("Invalid CONTRACT_ADDRESS");
  if (!cfg.rpcUrls || cfg.rpcUrls.length === 0) throw new Error("RPC URL(s) not configured");
  const contractAddress = cfg.contractAddress.toLowerCase() as Hex;

  const transport = cfg.rpcUrls.length > 1 ? fallback(cfg.rpcUrls.map((url) => http(url))) : http(cfg.rpcUrls[0]!);
  const chain = cfg.chainId === 1 ? mainnet : cfg.chainId === 11155111 ? sepolia : undefined;
  const client = createPublicClient({
    chain,
    transport,
  });

  // Sanity checks to prevent "cross-chain pollution" when CHAIN_ID / RPC_URL are misconfigured.
  // Without this, the indexer can store Sepolia events under chainId=1 (or vice-versa) and the UI will show incorrect totals.
  const actualChainId = await client.getChainId();
  if (actualChainId !== cfg.chainId) {
    throw new Error(`Indexer chainId mismatch: env CHAIN_ID=${cfg.chainId} but RPC reports chainId=${actualChainId}`);
  }
  const code = await client.getBytecode({ address: contractAddress });
  if (!code || code === "0x") {
    throw new Error(`Indexer contract not found: no code at ${contractAddress} on chainId=${cfg.chainId}`);
  }

  // Backfill from last indexed block (or from current head - 2k as a safe-ish dev default).
  const head = await client.getBlockNumber();
  const state = await prisma.indexerState.findUnique({
    where: { chainId_contractAddress: { chainId: cfg.chainId, contractAddress } }
  });
  const defaultFrom = BigInt(Math.max(0, Number(head) - 2000));
  const startFrom = typeof cfg.startBlock === "number" && Number.isFinite(cfg.startBlock) ? BigInt(cfg.startBlock) : null;
  let fromBlock = BigInt(state?.lastBlock ?? (startFrom ?? defaultFrom));
  if (fromBlock > head) fromBlock = head;

  await backfill(client, { ...cfg, contractAddress }, fromBlock, head);

  // Live tail.
  client.watchContractEvent({
    abi: ghBountiesAbi,
    address: contractAddress,
    onLogs: async (logs) => {
      for (const log of logs) await handleLog(client, { ...cfg, contractAddress }, log, { isBackfill: false });
    }
  });

  // Safety net: also poll for new logs and backfill from the last stored block.
  // This keeps the UI updating even if watchContractEvent is unreliable in some hosting setups.
  let pollInFlight = false;
  setInterval(async () => {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      const headNow = await client.getBlockNumber();
      const st = await prisma.indexerState.findUnique({
        where: { chainId_contractAddress: { chainId: cfg.chainId, contractAddress } }
      });
      const last = BigInt(st?.lastBlock ?? 0);
      const from = last > 0n ? last + 1n : headNow;
      if (from <= headNow) {
        await backfill(client, { ...cfg, contractAddress }, from, headNow);
      }
    } catch {
      // Best-effort: don't crash the API if the indexer poll fails.
    } finally {
      pollInFlight = false;
    }
  }, 30_000);
}

async function backfill(
  client: ReturnType<typeof createPublicClient>,
  cfg: IndexerConfig,
  fromBlock: bigint,
  toBlock: bigint
) {
  const prisma = getPrisma();
  if (fromBlock > toBlock) return;
  const chunkSize = BigInt(Math.max(1, cfg.backfillBlockChunk ?? 10));

  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const chunkEnd = cursor + chunkSize - 1n > toBlock ? toBlock : cursor + chunkSize - 1n;
    const logs = await client.getContractEvents({
      abi: ghBountiesAbi,
      address: cfg.contractAddress,
      fromBlock: cursor,
      toBlock: chunkEnd
    });

    for (const log of logs) await handleLog(client, cfg, log, { isBackfill: true });

    await prisma.indexerState.upsert({
      where: { chainId_contractAddress: { chainId: cfg.chainId, contractAddress: cfg.contractAddress } },
      create: { chainId: cfg.chainId, contractAddress: cfg.contractAddress, lastBlock: Number(chunkEnd) },
      update: { lastBlock: Number(chunkEnd) }
    });

    cursor = chunkEnd + 1n;
  }
}

async function handleLog(client: PublicClient, cfg: IndexerConfig, log: any, opts?: { isBackfill?: boolean }) {
  const prisma = getPrisma();
  const blockNumber = Number(log.blockNumber ?? 0n);
  const txHash = log.transactionHash as string;
  const logIndex = Number(log.logIndex ?? 0n);

  // NOTE: viem returns args as decoded objects.
  switch (log.eventName as string) {
    case "RepoRegistered": {
      const repoHash = log.args.repoHash as Hex;
      const maintainer = (log.args.maintainer as string).toLowerCase();
      await prisma.repo.upsert({
        where: { repoHash },
        create: { repoHash, maintainerAddress: maintainer },
        update: { maintainerAddress: maintainer }
      });
      break;
    }
    case "RepoMaintainerChanged": {
      const repoHash = log.args.repoHash as Hex;
      const newMaintainer = (log.args.newMaintainer as string).toLowerCase();
      await prisma.repo.upsert({
        where: { repoHash },
        create: { repoHash, maintainerAddress: newMaintainer },
        update: { maintainerAddress: newMaintainer }
      });
      break;
    }
    case "BountyCreated": {
      const bountyId = log.args.bountyId as Hex;
      const repoHash = log.args.repoHash as Hex;
      const issueNumber = Number(log.args.issueNumber as bigint);
      const metadataURI = (log.args.metadataURI as string) || "";

      await prisma.repo.upsert({
        where: { repoHash },
        create: { repoHash, maintainerAddress: "0x0000000000000000000000000000000000000000" },
        update: {}
      });

      await prisma.bounty.upsert({
        where: { bountyId },
        create: {
          bountyId,
          repoHash,
          issueNumber,
          metadataURI,
          status: "OPEN",
          chainId: cfg.chainId,
          contractAddress: cfg.contractAddress
        },
        update: {
          metadataURI,
          status: "OPEN",
          chainId: cfg.chainId,
          contractAddress: cfg.contractAddress
        }
      });

      // Best-effort label sync if metadataURI is a GitHub issue URL.
      try {
        await syncBountyLabels({ github: cfg.github ?? null, issueUrl: metadataURI, status: "OPEN" });
      } catch {
        // Don't break indexing on GitHub failures.
      }
      break;
    }
    case "BountyFunded": {
      const bountyId = log.args.bountyId as Hex;
      const token = (log.args.token as string).toLowerCase();
      const funder = (log.args.funder as string).toLowerCase();
      const amountWei = (log.args.amount as bigint).toString();
      const lockedUntil = Number(log.args.lockedUntil as bigint);
      const existingFunding = await prisma.funding.findUnique({
        where: { txHash_logIndex: { txHash, logIndex } }
      });

      await prisma.funding.upsert({
        where: { txHash_logIndex: { txHash, logIndex } },
        create: { bountyId, token, funder, amountWei, lockedUntil, txHash, logIndex, blockNumber },
        update: { bountyId, token, funder, amountWei, lockedUntil, blockNumber }
      });

      if (!existingFunding) {
        await bumpAssetTotals(prisma, bountyId, token, { funded: BigInt(amountWei), escrowed: BigInt(amountWei) });
      }

      try {
        const bounty = await prisma.bounty.findUnique({ where: { bountyId } });
        const issueUrl = bounty?.metadataURI;
        if (issueUrl) {
          const meta = await getTokenMeta(client, token);
          const amountDisplay = formatUnits(BigInt(amountWei), meta.decimals);
          const tokenLabel =
            meta.symbol && meta.symbol.length > 0
              ? meta.symbol
              : token === NATIVE_TOKEN
                ? "ETH"
                : `${token.slice(0, 6)}…${token.slice(-4)}`;
          const lines = [
            `💸 Bounty funded: ${amountDisplay} ${tokenLabel}`,
            `Funder: ${funder}`
          ];
          if (token !== NATIVE_TOKEN && (!meta.symbol || meta.symbol.length === 0)) {
            lines.push(`Token: ${token}`);
          }
          if (lockedUntil > 0) {
            const lockDate = new Date(lockedUntil * 1000).toISOString().replace("T", " ").replace("Z", " UTC");
            lines.push(`Lock until: ${lockDate}`);
          }
          await postIssueCommentIfMissing({
            github: cfg.github ?? null,
            issueUrl,
            body: lines.join("\n"),
            marker: eventMarker(cfg, "BountyFunded", txHash, logIndex)
          });
        }
      } catch {
        // Best-effort: don't block indexing if GitHub comment fails.
      }
      break;
    }
    case "ClaimSubmitted": {
      const bountyId = log.args.bountyId as Hex;
      const claimId = Number(log.args.claimId as bigint);
      const claimer = (log.args.claimer as string).toLowerCase();
      const metadataURI = (log.args.metadataURI as string) || "";

      await prisma.claim.upsert({
        where: { txHash_logIndex: { txHash, logIndex } },
        create: { bountyId, claimId, claimer, metadataURI, txHash, logIndex, blockNumber },
        update: { bountyId, claimId, claimer, metadataURI, blockNumber }
      });

      try {
        const bounty = await prisma.bounty.findUnique({ where: { bountyId } });
        const issueUrl = bounty?.metadataURI;
        if (issueUrl) {
          let ownerLogin: string | null = null;
          try {
            ownerLogin = parseGithubIssueUrl(issueUrl).owner;
          } catch {
            ownerLogin = null;
          }

          const lines = [
            `🧾 Claim submitted (#${claimId})`,
            `Claimer: ${claimer}`,
            metadataURI ? `Claim URL: ${metadataURI}` : null,
            ownerLogin
              ? `@${ownerLogin} please review and either authorize a payout to the claimer (if accepted) or process a refund (if not).`
              : "Repo admins: please review and either authorize a payout to the claimer (if accepted) or process a refund (if not)."
          ].filter(Boolean) as string[];
          await postIssueCommentIfMissing({
            github: cfg.github ?? null,
            issueUrl,
            body: lines.join("\n"),
            marker: eventMarker(cfg, "ClaimSubmitted", txHash, logIndex)
          });
        }
      } catch {
        // Best-effort: don't block indexing if GitHub comment fails.
      }
      break;
    }
    case "StatusChanged": {
      const bountyId = log.args.bountyId as Hex;
      const status = statusFromEnum(Number(log.args.status as bigint));
      await prisma.bounty.update({ where: { bountyId }, data: { status } });

      try {
        const b = await prisma.bounty.findUnique({ where: { bountyId } });
        if (b?.metadataURI) await syncBountyLabels({ github: cfg.github ?? null, issueUrl: b.metadataURI, status });
      } catch {
        // best-effort
      }
      break;
    }
    case "PaidOut": {
      const bountyId = log.args.bountyId as Hex;
      const token = (log.args.token as string).toLowerCase();
      const recipient = (log.args.recipient as string).toLowerCase();
      const amountWei = (log.args.amount as bigint).toString();
      const existingPayout = await prisma.payout.findUnique({
        where: { txHash_logIndex: { txHash, logIndex } }
      });

      await prisma.payout.upsert({
        where: { txHash_logIndex: { txHash, logIndex } },
        create: { bountyId, token, recipient, amountWei, txHash, logIndex, blockNumber },
        update: { bountyId, token, recipient, amountWei, blockNumber }
      });

      if (!existingPayout) {
        await bumpAssetTotals(prisma, bountyId, token, { paid: BigInt(amountWei), escrowed: -BigInt(amountWei) });
      }

      try {
        const bounty = await prisma.bounty.findUnique({ where: { bountyId } });
        const issueUrl = bounty?.metadataURI;
        if (issueUrl) {
          const meta = await getTokenMeta(client, token);
          const amountDisplay = formatUnits(BigInt(amountWei), meta.decimals);
          const tokenLabel =
            meta.symbol && meta.symbol.length > 0
              ? meta.symbol
              : token === NATIVE_TOKEN
                ? "ETH"
                : `${token.slice(0, 6)}…${token.slice(-4)}`;
          const lines = [
            `✅ Payout completed: ${amountDisplay} ${tokenLabel}`,
            `Recipient: ${recipient}`
          ];
          if (token !== NATIVE_TOKEN && (!meta.symbol || meta.symbol.length === 0)) {
            lines.push(`Token: ${token}`);
          }
          await postIssueCommentIfMissing({
            github: cfg.github ?? null,
            issueUrl,
            body: lines.join("\n"),
            marker: eventMarker(cfg, "PaidOut", txHash, logIndex)
          });
        }
      } catch {
        // Best-effort: don't block indexing if GitHub comment fails.
      }
      break;
    }
    case "Refunded": {
      const bountyId = log.args.bountyId as Hex;
      const token = (log.args.token as string).toLowerCase();
      const funder = (log.args.funder as string).toLowerCase();
      const amountWei = (log.args.amount as bigint).toString();
      const existingRefund = await prisma.refund.findUnique({
        where: { txHash_logIndex: { txHash, logIndex } }
      });

      await prisma.refund.upsert({
        where: { txHash_logIndex: { txHash, logIndex } },
        create: { bountyId, token, funder, amountWei, txHash, logIndex, blockNumber },
        update: { bountyId, token, funder, amountWei, blockNumber }
      });

      if (!existingRefund) {
        await bumpAssetTotals(prisma, bountyId, token, { escrowed: -BigInt(amountWei) });
      }

      try {
        const bounty = await prisma.bounty.findUnique({ where: { bountyId } });
        const issueUrl = bounty?.metadataURI;
        if (issueUrl) {
          const meta = await getTokenMeta(client, token);
          const amountDisplay = formatUnits(BigInt(amountWei), meta.decimals);
          const tokenLabel =
            meta.symbol && meta.symbol.length > 0
              ? meta.symbol
              : token === NATIVE_TOKEN
                ? "ETH"
                : `${token.slice(0, 6)}…${token.slice(-4)}`;
          const lines = [
            `↩️ Refund completed: ${amountDisplay} ${tokenLabel}`,
            `Funder: ${funder}`
          ];
          if (token !== NATIVE_TOKEN && (!meta.symbol || meta.symbol.length === 0)) {
            lines.push(`Token: ${token}`);
          }
          await postIssueCommentIfMissing({
            github: cfg.github ?? null,
            issueUrl,
            body: lines.join("\n"),
            marker: eventMarker(cfg, "Refunded", txHash, logIndex)
          });
        }
      } catch {
        // Best-effort: don't block indexing if GitHub comment fails.
      }
      break;
    }
    default:
      break;
  }

  await prisma.indexerState.upsert({
    where: { chainId_contractAddress: { chainId: cfg.chainId, contractAddress: cfg.contractAddress } },
    create: { chainId: cfg.chainId, contractAddress: cfg.contractAddress, lastBlock: blockNumber },
    update: { lastBlock: blockNumber }
  });
}
