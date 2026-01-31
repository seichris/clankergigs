import { getPrisma } from "../db.js";
import { ghBountiesAbi } from "./abi.js";
import { createPublicClient, http, isAddress, formatUnits, type Hex } from "viem";
import { syncBountyLabels } from "../github/labels.js";
import { postIssueComment } from "../github/comments.js";
import type { GithubAuthConfig } from "../github/appAuth.js";

type IndexerConfig = {
  rpcUrl: string;
  chainId: number;
  contractAddress: Hex;
  github?: GithubAuthConfig | null;
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

export async function startIndexer(cfg: IndexerConfig) {
  const prisma = getPrisma();
  if (!isAddress(cfg.contractAddress)) throw new Error("Invalid CONTRACT_ADDRESS");

  const client = createPublicClient({
    transport: http(cfg.rpcUrl)
  });

  // Backfill from last indexed block (or from current head - 2k as a safe-ish dev default).
  const head = await client.getBlockNumber();
  const state = await prisma.indexerState.findUnique({
    where: { chainId_contractAddress: { chainId: cfg.chainId, contractAddress: cfg.contractAddress } }
  });
  const fromBlock = BigInt(state?.lastBlock ?? Math.max(0, Number(head) - 2000));

  await backfill(client, cfg, fromBlock, head);

  // Live tail.
  client.watchContractEvent({
    abi: ghBountiesAbi,
    address: cfg.contractAddress,
    onLogs: async (logs) => {
      for (const log of logs) await handleLog(client, cfg, log, { isBackfill: false });
    }
  });
}

async function backfill(
  client: ReturnType<typeof createPublicClient>,
  cfg: IndexerConfig,
  fromBlock: bigint,
  toBlock: bigint
) {
  const prisma = getPrisma();
  const logs = await client.getContractEvents({
    abi: ghBountiesAbi,
    address: cfg.contractAddress,
    fromBlock,
    toBlock
  });

  for (const log of logs) await handleLog(client, cfg, log, { isBackfill: true });

  await prisma.indexerState.upsert({
    where: { chainId_contractAddress: { chainId: cfg.chainId, contractAddress: cfg.contractAddress } },
    create: { chainId: cfg.chainId, contractAddress: cfg.contractAddress, lastBlock: Number(toBlock) },
    update: { lastBlock: Number(toBlock) }
  });
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
          status: "OPEN"
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

      await prisma.funding.create({
        data: { bountyId, token, funder, amountWei, lockedUntil, txHash, logIndex, blockNumber }
      });

      await bumpAssetTotals(prisma, bountyId, token, { funded: BigInt(amountWei), escrowed: BigInt(amountWei) });

      if (!opts?.isBackfill) {
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
            await postIssueComment({ github: cfg.github ?? null, issueUrl, body: lines.join("\n") });
          }
        } catch {
          // Best-effort: don't block indexing if GitHub comment fails.
        }
      }
      break;
    }
    case "ClaimSubmitted": {
      const bountyId = log.args.bountyId as Hex;
      const claimId = Number(log.args.claimId as bigint);
      const claimer = (log.args.claimer as string).toLowerCase();
      const metadataURI = (log.args.metadataURI as string) || "";

      await prisma.claim.create({
        data: { bountyId, claimId, claimer, metadataURI, txHash, logIndex, blockNumber }
      });
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

      await prisma.payout.create({
        data: { bountyId, token, recipient, amountWei, txHash, logIndex, blockNumber }
      });

      await bumpAssetTotals(prisma, bountyId, token, { paid: BigInt(amountWei), escrowed: -BigInt(amountWei) });
      break;
    }
    case "Refunded": {
      const bountyId = log.args.bountyId as Hex;
      const token = (log.args.token as string).toLowerCase();
      const funder = (log.args.funder as string).toLowerCase();
      const amountWei = (log.args.amount as bigint).toString();

      await prisma.refund.create({
        data: { bountyId, token, funder, amountWei, txHash, logIndex, blockNumber }
      });

      await bumpAssetTotals(prisma, bountyId, token, { escrowed: -BigInt(amountWei) });
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
