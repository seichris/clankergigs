import Fastify from "fastify";
import cors from "@fastify/cors";
import { getPrisma } from "./db.js";
import { registerGithubWebhookRoutes } from "./github/webhook.js";

export async function buildServer() {
  const app = Fastify({ logger: true });
  const prisma = getPrisma();

  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true }));

  registerGithubWebhookRoutes(app, {
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET
  });

  app.get("/bounties", async (req) => {
    const q = req.query as { repoHash?: string; issueNumber?: string; bountyId?: string };
    if (q.bountyId) {
      const b = await prisma.bounty.findUnique({
        where: { bountyId: q.bountyId },
        include: { assets: true, fundings: true, claims: true, payouts: true, refunds: true }
      });
      return { bounty: b };
    }

    const where: any = {};
    if (q.repoHash) where.repoHash = q.repoHash;
    if (q.issueNumber) where.issueNumber = Number(q.issueNumber);

    const bounties = await prisma.bounty.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 100
    });
    return { bounties };
  });

  return app;
}
