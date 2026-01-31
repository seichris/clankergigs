import { getPrisma } from "../db.js";
import { ghBountiesAbi } from "./abi.js";
import { createPublicClient, http, isAddress, type Hex } from "viem";
import { syncBountyLabels } from "../github/labels.js";

type IndexerConfig = {
  rpcUrl: string;
  chainId: number;
  contractAddress: Hex;
  github?: { appId: string; installationId: string; privateKeyPem: string } | null;
};

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
      for (const log of logs) await handleLog(cfg, log);
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

  for (const log of logs) await handleLog(cfg, log);

  await prisma.indexerState.upsert({
    where: { chainId_contractAddress: { chainId: cfg.chainId, contractAddress: cfg.contractAddress } },
    create: { chainId: cfg.chainId, contractAddress: cfg.contractAddress, lastBlock: Number(toBlock) },
    update: { lastBlock: Number(toBlock) }
  });
}

async function handleLog(cfg: IndexerConfig, log: any) {
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
