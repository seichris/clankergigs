import Fastify from "fastify";
import cors, { type FastifyCorsOptions } from "@fastify/cors";
import { getPrisma } from "./db.js";
import { registerGithubWebhookRoutes } from "./github/webhook.js";
import { getGithubAccessTokenFromRequest, getGithubUserFromRequest, registerGithubOAuthRoutes } from "./github/oauth.js";
import type { GithubAuthConfig } from "./github/appAuth.js";
import { parseGithubIssueUrl, parseGithubPullRequestUrl } from "./github/parse.js";
import { fetchGithubIssueByUrl } from "./github/issue.js";
import { backfillLinkedPullRequests } from "./github/backfill.js";

export async function buildServer(opts?: { github?: GithubAuthConfig | null }) {
  const app = Fastify({ logger: true });
  const prisma = getPrisma();

  const webOrigin = process.env.WEB_ORIGIN || "http://localhost:3000";
  const webOrigins = webOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = new Set(webOrigins.length > 0 ? webOrigins : ["http://localhost:3000"]);
  const corsOrigin: FastifyCorsOptions["origin"] = async (origin?: string) => {
    if (!origin) return false;
    return allowedOrigins.has(origin) ? origin : false;
  };
  // CORS is only needed for browser-based API calls (e.g. /bounties, /payout-auth, /auth/me).
  // Use credentials so the GitHub OAuth session cookie can be sent.
  await app.register(cors, { origin: corsOrigin, credentials: true });

  app.get("/health", async () => ({ ok: true }));

  registerGithubOAuthRoutes(app);

  registerGithubWebhookRoutes(app, {
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
    github: opts?.github ?? null
  });

  app.post("/github/backfill-prs", async (req, reply) => {
    const secret = process.env.GITHUB_BACKFILL_SECRET;
    if (secret) {
      const auth = req.headers.authorization || "";
      const token = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
      const query = req.query as { secret?: string };
      if (token !== secret && query?.secret !== secret) {
        return reply.code(401).send({ ok: false, error: "Unauthorized" });
      }
    }

    const rawBody = req.body as any;
    let body: any = rawBody;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = null;
      }
    }
    if (body && typeof body === "object" && (Buffer.isBuffer(body) || body instanceof Uint8Array)) {
      try {
        const text = Buffer.from(body).toString("utf8");
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }

    const result = await backfillLinkedPullRequests({
      prisma,
      github: opts?.github ?? null,
      repo: typeof body?.repo === "string" ? body.repo : undefined,
      issueUrl: typeof body?.issueUrl === "string" ? body.issueUrl : undefined,
      take: body?.take,
      maxPages: body?.maxPages,
      dryRun: Boolean(body?.dryRun),
      logger: req.log
    });

    const status = result.ok ? 200 : 400;
    return reply.code(status).send(result);
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

  app.get("/issues", async (req) => {
    const q = req.query as { q?: string; status?: string; take?: string; include?: string };
    const chainId = Number(process.env.CHAIN_ID || "0");
    const contractAddress = (process.env.CONTRACT_ADDRESS || "").toLowerCase();
    const take = Math.min(Math.max(Number(q.take || "200"), 1), 500);
    const includeGithub = q.include === "github";
    const where: any = {};
    if (chainId) where.chainId = chainId;
    if (contractAddress) where.contractAddress = contractAddress;
    if (q.status) where.status = q.status;

    const bounties = await prisma.bounty.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take,
      include: {
        assets: true,
        fundings: { select: { token: true, amountWei: true, lockedUntil: true, createdAt: true, funder: true } },
        claims: { select: { createdAt: true } },
        payouts: { select: { createdAt: true } },
        refunds: { select: { createdAt: true } },
        linkedPullRequests: { select: { createdAt: true, prUrl: true } },
        _count: { select: { fundings: true, claims: true, payouts: true, refunds: true } }
      }
    });
    const nowSec = Math.floor(Date.now() / 1000);
    const daySeconds = 24 * 60 * 60;

    function dayOffset(lockedUntil: number) {
      if (!lockedUntil || Number.isNaN(lockedUntil)) return 0;
      return Math.max(0, Math.ceil((lockedUntil - nowSec) / daySeconds));
    }

    function buildUnlockSchedule(
      fundings: Array<{ token: string; amountWei: string; lockedUntil: number }>,
      assets: Array<{ token: string; escrowed: string }>
    ) {
      const result: Array<{ token: string; totalEscrowedWei: string; days: Array<{ day: number; amountWei: string }> }> = [];
      const escrowByToken = new Map<string, bigint>();
      for (const asset of assets) {
        try {
          escrowByToken.set(asset.token.toLowerCase(), BigInt(asset.escrowed));
        } catch {
          escrowByToken.set(asset.token.toLowerCase(), 0n);
        }
      }

      for (const [token, escrowed] of escrowByToken.entries()) {
        if (escrowed <= 0n) {
          result.push({ token, totalEscrowedWei: "0", days: [] });
          continue;
        }

        const tokenFundings = fundings
          .filter((f) => f.token.toLowerCase() === token)
          .map((f) => ({
            lockedUntil: Number(f.lockedUntil || 0),
            amountWei: f.amountWei
          }))
          .sort((a, b) => a.lockedUntil - b.lockedUntil);

        let remaining = escrowed;
        const dayMap = new Map<number, bigint>();

        for (const funding of tokenFundings) {
          if (remaining <= 0n) break;
          let amount = 0n;
          try {
            amount = BigInt(funding.amountWei);
          } catch {
            continue;
          }
          if (amount <= 0n) continue;
          const take = amount < remaining ? amount : remaining;
          const day = dayOffset(funding.lockedUntil);
          dayMap.set(day, (dayMap.get(day) ?? 0n) + take);
          remaining -= take;
        }

        const days = Array.from(dayMap.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([day, amountWei]) => ({ day, amountWei: amountWei.toString() }));

        result.push({ token, totalEscrowedWei: escrowed.toString(), days });
      }

      return result;
    }

    function buildActivityTimeline(bounty: {
      createdAt: Date;
      fundings: Array<{ createdAt: Date }>;
      claims: Array<{ createdAt: Date }>;
      payouts: Array<{ createdAt: Date }>;
      refunds: Array<{ createdAt: Date }>;
      linkedPullRequests: Array<{ createdAt: Date }>;
    }) {
      const start = bounty.createdAt;
      const end = new Date();
      const dayMs = 24 * 60 * 60 * 1000;
      const maxDay = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / dayMs));

      const dayMap = new Map<number, Array<{ type: string; timestamp: string }>>();

      function addEvent(day: number, type: string, timestamp: Date) {
        const entry = dayMap.get(day) || [];
        entry.push({ type, timestamp: timestamp.toISOString() });
        dayMap.set(day, entry);
      }

      function dayOffset(date: Date) {
        const diff = date.getTime() - start.getTime();
        return Math.max(0, Math.floor(diff / dayMs));
      }

      for (const f of bounty.fundings) addEvent(dayOffset(f.createdAt), "funding", f.createdAt);
      for (const c of bounty.claims) addEvent(dayOffset(c.createdAt), "claim", c.createdAt);
      for (const p of bounty.payouts) addEvent(dayOffset(p.createdAt), "payout", p.createdAt);
      for (const r of bounty.refunds) addEvent(dayOffset(r.createdAt), "refund", r.createdAt);
      for (const l of bounty.linkedPullRequests) addEvent(dayOffset(l.createdAt), "linked_pr", l.createdAt);

      const days = Array.from(dayMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([day, events]) => ({ day, events }));

      return {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        maxDay,
        days
      };
    }

    const issues = bounties.map((b) => {
      let parsed: { owner: string; repo: string; issueNumber: number } | null = null;
      try {
        parsed = parseGithubIssueUrl(b.metadataURI);
      } catch {
        parsed = null;
      }

      const unlockSchedule = buildUnlockSchedule(
        b.fundings.map((f) => ({
          token: f.token,
          amountWei: f.amountWei,
          lockedUntil: f.lockedUntil
        })),
        b.assets.map((a) => ({ token: a.token, escrowed: a.escrowed }))
      );
      const activityTimeline = buildActivityTimeline({
        createdAt: b.createdAt,
        fundings: b.fundings.map((f) => ({ createdAt: f.createdAt })),
        claims: b.claims.map((c) => ({ createdAt: c.createdAt })),
        payouts: b.payouts.map((p) => ({ createdAt: p.createdAt })),
        refunds: b.refunds.map((r) => ({ createdAt: r.createdAt })),
        linkedPullRequests: b.linkedPullRequests.map((l) => ({ createdAt: l.createdAt }))
      });
      const funders = Array.from(
        new Set(
          b.fundings
            .map((f) => (f.funder ? f.funder.toLowerCase() : ""))
            .filter((addr) => addr.length > 0)
        )
      );

      return {
        issueUrl: b.metadataURI,
        owner: parsed?.owner ?? null,
        repo: parsed?.repo ?? null,
        issueNumber: parsed?.issueNumber ?? null,
        repoHash: b.repoHash,
        bountyId: b.bountyId,
        status: b.status,
        chainId: b.chainId,
        contractAddress: b.contractAddress,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        assets: b.assets.map((asset) => ({
          token: asset.token,
          fundedWei: asset.funded,
          escrowedWei: asset.escrowed,
          paidWei: asset.paid
        })),
        unlockSchedule,
        activityTimeline,
        funders,
        linkedPullRequests: b.linkedPullRequests.map((l) => ({
          prUrl: l.prUrl,
          createdAt: l.createdAt
        })),
        counts: {
          fundings: b._count.fundings,
          claims: b._count.claims,
          payouts: b._count.payouts,
          refunds: b._count.refunds,
          linkedPrs: b.linkedPullRequests.length
        },
        github: null as any
      };
    });

    if (includeGithub) {
      const token = await getGithubAccessTokenFromRequest(req);
      const concurrency = 5;
      for (let i = 0; i < issues.length; i += concurrency) {
        const slice = issues.slice(i, i + concurrency);
        const results = await Promise.all(
          slice.map((issue) =>
            fetchGithubIssueByUrl({ issueUrl: issue.issueUrl, token }).catch(() => null)
          )
        );
        results.forEach((github, idx) => {
          slice[idx].github = github;
        });
      }
    }

    if (q.q) {
      const query = q.q.toLowerCase();
      return {
        issues: issues.filter((issue) => {
          const parts = [
            issue.issueUrl,
            issue.owner,
            issue.repo,
            issue.issueNumber ? String(issue.issueNumber) : null,
            issue.status,
            issue.github?.title ?? null,
            issue.github?.state ?? null,
            issue.github?.labels?.map((label: any) => label.name).join(" ") ?? null,
            issue.github?.repo?.description ?? null,
            issue.github?.repo?.homepage ?? null
          ].filter(Boolean) as string[];
          return parts.some((p) => p.toLowerCase().includes(query));
        })
      };
    }

    return { issues };
  });

  app.get("/github/issue", async (req, reply) => {
    const q = req.query as { url?: string };
    const issueUrl = typeof q.url === "string" ? q.url.trim() : "";
    if (!issueUrl) return reply.code(400).send({ error: "Missing url" });
    const token = await getGithubAccessTokenFromRequest(req);
    const issue = await fetchGithubIssueByUrl({ issueUrl, token });
    return reply.send({ issue });
  });

  app.get("/github/pull", async (req, reply) => {
    const q = req.query as { url?: string };
    const prUrl = typeof q.url === "string" ? q.url.trim() : "";
    if (!prUrl) return reply.code(400).send({ error: "Missing url" });

    const user = await getGithubUserFromRequest(req);
    if (!user) return reply.code(401).send({ error: "Not logged in" });

    const token = await getGithubAccessTokenFromRequest(req);
    if (!token) return reply.code(401).send({ error: "Not logged in" });

    let owner: string;
    let repo: string;
    let pullNumber: number;
    try {
      const parsed = parseGithubPullRequestUrl(prUrl);
      owner = parsed.owner;
      repo = parsed.repo;
      pullNumber = parsed.pullNumber;
    } catch {
      return reply.code(400).send({ error: "Invalid pull request URL" });
    }

    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "gh-bounties"
      }
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return reply.code(res.status).send({ error: `GitHub API error (${res.status}): ${text || res.statusText}` });
    }

    const payload = (await res.json()) as any;
    const pull = {
      title: payload?.title ?? "",
      state: payload?.state ?? "unknown",
      merged: Boolean(payload?.merged),
      htmlUrl: payload?.html_url ?? prUrl,
      author: payload?.user?.login ?? null,
      number: payload?.number ?? pullNumber,
      repo: { owner, repo }
    };

    const isAuthor = pull.author ? pull.author.toLowerCase() === user.login.toLowerCase() : false;
    return reply.send({ pull, isAuthor, user: { login: user.login, id: user.id } });
  });

  return app;
}
