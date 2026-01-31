import Fastify from "fastify";
import cors from "@fastify/cors";
import { getPrisma } from "./db.js";
import { registerGithubWebhookRoutes } from "./github/webhook.js";
import { registerGithubOAuthRoutes } from "./github/oauth.js";

export async function buildServer() {
  const app = Fastify({ logger: true });
  const prisma = getPrisma();

  const webOrigin = process.env.WEB_ORIGIN || "http://localhost:3000";
  // CORS is only needed for browser-based API calls (e.g. /bounties, /payout-auth, /auth/me).
  // Use credentials so the GitHub OAuth session cookie can be sent.
  await app.register(cors, { origin: webOrigin, credentials: true });

  app.get("/health", async () => ({ ok: true }));

  registerGithubOAuthRoutes(app);

  registerGithubWebhookRoutes(app, {
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET
  });

  app.get("/bounties", async (req) => {
    const q = req.query as { repoHash?: string; issueNumber?: string; bountyId?: string };
    const chainId = Number(process.env.CHAIN_ID || "0");
    const contractAddress = (process.env.CONTRACT_ADDRESS || "").toLowerCase();
    if (q.bountyId) {
      const b = await prisma.bounty.findFirst({
        where: {
          bountyId: q.bountyId,
          ...(chainId ? { chainId } : {}),
          ...(contractAddress ? { contractAddress } : {})
        },
        include: { assets: true, fundings: true, claims: true, payouts: true, refunds: true }
      });
      return { bounty: b };
    }

    const where: any = {};
    if (chainId) where.chainId = chainId;
    if (contractAddress) where.contractAddress = contractAddress;
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
