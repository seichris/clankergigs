import Fastify from "fastify";
import cors, { type FastifyCorsOptions } from "@fastify/cors";
import { getPrisma } from "./db.js";
import type { Prisma } from "../prisma/generated/client/index.js";

type BountyWithRelations = Prisma.BountyGetPayload<{
  include: {
    fundings: { select: { receiptObjectId: true; funder: true; amountMist: true; lockedUntilMs: true; createdAt: true } };
    claims: { select: { claimObjectId: true; claimer: true; claimUrl: true; createdAt: true } };
    payouts: { select: { recipient: true; amountMist: true; createdAt: true } };
    refunds: { select: { funder: true; amountMist: true; createdAt: true } };
  };
}>;

function serializeBounty(b: BountyWithRelations) {
  return {
    bountyObjectId: b.bountyObjectId,
    repo: b.repo,
    issueNumber: b.issueNumber,
    issueUrl: b.issueUrl,
    admin: b.admin,
    status: b.status,
    fundedMist: b.fundedMist,
    escrowedMist: b.escrowedMist,
    paidMist: b.paidMist,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
    fundings: b.fundings.map((f) => ({
      receiptObjectId: f.receiptObjectId,
      funder: f.funder,
      amountMist: f.amountMist,
      lockedUntilMs: f.lockedUntilMs.toString(),
      createdAt: f.createdAt.toISOString()
    })),
    claims: b.claims.map((c) => ({
      claimObjectId: c.claimObjectId,
      claimer: c.claimer,
      claimUrl: c.claimUrl,
      createdAt: c.createdAt.toISOString()
    })),
    payouts: b.payouts.map((p) => ({
      recipient: p.recipient,
      amountMist: p.amountMist,
      createdAt: p.createdAt.toISOString()
    })),
    refunds: b.refunds.map((r) => ({
      funder: r.funder,
      amountMist: r.amountMist,
      createdAt: r.createdAt.toISOString()
    }))
  };
}

export async function buildServer() {
  const app = Fastify({ logger: true });
  const prisma = getPrisma();

  const webOrigin = process.env.WEB_ORIGIN || "http://localhost:3001";
  const webOrigins = webOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = new Set(webOrigins.length > 0 ? webOrigins : ["http://localhost:3001"]);
  const corsOrigin: FastifyCorsOptions["origin"] = async (origin?: string) => {
    if (!origin) return false;
    return allowedOrigins.has(origin) ? origin : false;
  };
  await app.register(cors, { origin: corsOrigin, credentials: true });

  app.get("/health", async () => ({ ok: true }));

  app.get("/issues", async (req) => {
    const q = req.query as { take?: string };
    const take = Math.min(Math.max(Number(q.take || "200"), 1), 500);

    const bounties = await prisma.bounty.findMany({
      orderBy: { updatedAt: "desc" },
      take,
      include: {
        fundings: { select: { receiptObjectId: true, funder: true, amountMist: true, lockedUntilMs: true, createdAt: true } },
        claims: { select: { claimObjectId: true, claimer: true, claimUrl: true, createdAt: true } },
        payouts: { select: { recipient: true, amountMist: true, createdAt: true } },
        refunds: { select: { funder: true, amountMist: true, createdAt: true } }
      }
    });

    return {
      issues: bounties.map(serializeBounty)
    };
  });

  app.get("/bounties", async (req) => {
    const q = req.query as { bountyObjectId?: string };
    const bountyObjectId = typeof q.bountyObjectId === "string" ? q.bountyObjectId.trim() : "";
    if (!bountyObjectId) return { bounty: null };
    const b = await prisma.bounty.findUnique({
      where: { bountyObjectId },
      include: {
        fundings: { select: { receiptObjectId: true, funder: true, amountMist: true, lockedUntilMs: true, createdAt: true } },
        claims: { select: { claimObjectId: true, claimer: true, claimUrl: true, createdAt: true } },
        payouts: { select: { recipient: true, amountMist: true, createdAt: true } },
        refunds: { select: { funder: true, amountMist: true, createdAt: true } }
      }
    });
    return { bounty: b ? serializeBounty(b) : null };
  });

  return app;
}
