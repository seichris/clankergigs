import { BridgeKit } from "@circle-fin/bridge-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import type { FastifyBaseLogger } from "fastify";
import { formatUnits, type Hex } from "viem";
import { getPrisma } from "../db.js";
import { gatewayMintOnArc } from "./arcMint.js";
import { GATEWAY_TESTNET_CONTRACTS } from "./config.js";
import { loadTreasuryEnvFromProcess } from "./env.js";

function extractTxHashes(result: any): { first?: string; last?: string } {
  const hashes: string[] = [];
  const walk = (v: any) => {
    if (!v) return;
    if (typeof v === "string" && /^0x[a-fA-F0-9]{64}$/.test(v)) hashes.push(v);
    if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(result);
  return { first: hashes[0], last: hashes[hashes.length - 1] };
}

export function startTreasuryOrchestrator(logger: FastifyBaseLogger) {
  const env = loadTreasuryEnvFromProcess();
  if (!env.enabled) return;
  if (!env.orchestrator.enabled) return;

  const prisma = getPrisma();
  const kit = new BridgeKit();
  const adapter = env.circleWallets
    ? createCircleWalletsAdapter({
        apiKey: env.circleWallets.apiKey,
        entitySecret: env.circleWallets.entitySecret,
        baseUrl: env.circleWallets.baseUrl
      } as any)
    : createViemAdapterFromPrivateKey({ privateKey: env.destinationCallerPrivateKey });

  let running = false;
  const intervalMs = env.orchestrator.intervalMs;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // ---- Funding: transfer_submitted -> credited ----
      const fundings = await prisma.treasuryFundingIntent.findMany({
        where: { status: "transfer_submitted" },
        orderBy: { createdAt: "asc" },
        take: 5
      });

      for (const intent of fundings) {
        if (!intent.gatewayAttestation || !intent.gatewayAttestationSignature) continue;
        try {
          const minted = await gatewayMintOnArc({
            rpcUrl: env.arc.rpcUrl,
            chainId: env.arc.chainId,
            minterContract: GATEWAY_TESTNET_CONTRACTS.minterContract,
            destinationCallerPrivateKey: env.destinationCallerPrivateKey,
            attestation: intent.gatewayAttestation as Hex,
            signature: intent.gatewayAttestationSignature as Hex
          });

          const amount = BigInt(intent.amountUsdc || "0");
          await prisma.$transaction(async (tx) => {
            await tx.treasuryFundingIntent.update({
              where: { id: intent.id },
              data: { status: "credited", arcMintTxHash: minted.hash }
            });
            const ledger = await tx.treasuryBountyLedger.upsert({
              where: { bountyId: intent.bountyId },
              create: { bountyId: intent.bountyId },
              update: {}
            });
            await tx.treasuryBountyLedger.update({
              where: { bountyId: intent.bountyId },
              data: {
                totalFundedUsdc: (BigInt(ledger.totalFundedUsdc) + amount).toString(),
                availableUsdc: (BigInt(ledger.availableUsdc) + amount).toString()
              }
            });
          });

          logger.info({ intentId: intent.id, mintTx: minted.hash }, "treasury funding minted and credited");
        } catch (err: any) {
          await prisma.treasuryFundingIntent.update({
            where: { id: intent.id },
            data: { status: "failed", error: err?.message ?? String(err) }
          });
          logger.warn({ intentId: intent.id, err: err?.message ?? String(err) }, "treasury funding mint failed");
        }
      }

      // ---- Payouts: created -> confirmed/failed ----
      const payouts = await prisma.treasuryPayoutIntent.findMany({
        where: { status: "created" },
        orderBy: { createdAt: "asc" },
        take: 3
      });

      for (const payout of payouts) {
        const amount = BigInt(payout.amountUsdc || "0");
        try {
          await prisma.treasuryPayoutIntent.update({ where: { id: payout.id }, data: { status: "executing" } });

          const amountDecimal = formatUnits(amount, 6);
          const res = await kit.bridge({
            from: { chain: "Arc_Testnet", adapter },
            to: { chain: payout.destinationChain, recipientAddress: payout.recipient, adapter },
            amount: amountDecimal
          } as any);

          const hashes = extractTxHashes(res);

          await prisma.$transaction(async (tx) => {
            await tx.treasuryPayoutIntent.update({
              where: { id: payout.id },
              data: {
                status: "confirmed",
                bridgeTxHash: hashes.first ?? null,
                finalTxHash: hashes.last ?? null
              }
            });
            const ledger = await tx.treasuryBountyLedger.findUnique({ where: { bountyId: payout.bountyId } });
            if (ledger) {
              await tx.treasuryBountyLedger.update({
                where: { bountyId: payout.bountyId },
                data: { totalPaidUsdc: (BigInt(ledger.totalPaidUsdc) + amount).toString() }
              });
            }
          });

          logger.info({ payoutId: payout.id, destination: payout.destinationChain }, "treasury payout confirmed");
        } catch (err: any) {
          const msg = err?.message ?? String(err);
          await prisma.$transaction(async (tx) => {
            await tx.treasuryPayoutIntent.update({ where: { id: payout.id }, data: { status: "failed", error: msg } });
            const ledger = await tx.treasuryBountyLedger.findUnique({ where: { bountyId: payout.bountyId } });
            if (ledger) {
              await tx.treasuryBountyLedger.update({
                where: { bountyId: payout.bountyId },
                data: { availableUsdc: (BigInt(ledger.availableUsdc) + amount).toString() }
              });
            }
          });
          logger.warn({ payoutId: payout.id, err: msg }, "treasury payout failed (restored availableUsdc)");
        }
      }
    } catch (err: any) {
      logger.warn({ err: err?.message ?? String(err) }, "treasury orchestrator tick failed");
    } finally {
      running = false;
    }
  };

  tick().catch(() => {
    // logged inside
  });
  setInterval(() => {
    tick().catch(() => {
      // logged inside
    });
  }, intervalMs);

  logger.info({ intervalMs }, "treasury orchestrator started");
}
