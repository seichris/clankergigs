import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { getPrisma } from "../db.js";
import type { GithubAuthConfig } from "./appAuth.js";
import { postPullRequestCommentIfMissing } from "./comments.js";

const COMMENT_MARKER = "<!-- gh-bounties-pr-claim-reminder -->";

function timingSafeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function verifyGithubSignature(secret: string, rawBody: Buffer, signatureHeader: string | undefined) {
  if (!secret) return false;
  if (!signatureHeader) return false;
  // GitHub: "sha256=<hex>"
  if (!signatureHeader.startsWith("sha256=")) return false;

  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeEqual(expected, signatureHeader);
}

function canonicalIssueUrl(owner: string, repo: string, issueNumber: number) {
  return `https://github.com/${owner}/${repo}/issues/${issueNumber}`;
}

function extractIssueReferences(text: string, defaultOwner: string, defaultRepo: string) {
  const results = new Set<string>();

  const urlRegex = /https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)/gi;
  for (const match of text.matchAll(urlRegex)) {
    const owner = match[1];
    const repo = match[2];
    const issueNumber = Number(match[3]);
    if (!Number.isFinite(issueNumber)) continue;
    results.add(canonicalIssueUrl(owner, repo, issueNumber));
  }

  const shortRegex = /([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)/g;
  for (const match of text.matchAll(shortRegex)) {
    const owner = match[1];
    const repo = match[2];
    const issueNumber = Number(match[3]);
    if (!Number.isFinite(issueNumber)) continue;
    results.add(canonicalIssueUrl(owner, repo, issueNumber));
  }

  const hashRegex = /(?:^|[^A-Za-z0-9_/])#(\d+)/g;
  for (const match of text.matchAll(hashRegex)) {
    const issueNumber = Number(match[1]);
    if (!Number.isFinite(issueNumber)) continue;
    results.add(canonicalIssueUrl(defaultOwner, defaultRepo, issueNumber));
  }

  return Array.from(results);
}

export function registerGithubWebhookRoutes(
  app: FastifyInstance,
  opts: { webhookSecret?: string; github?: GithubAuthConfig | null }
) {
  // Keep the raw payload (required for signature verification).
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, async (_req: any, body: any) => body as Buffer);

  app.post("/github/webhook", async (req, reply) => {
    const secret = opts.webhookSecret || "";
    const raw = req.body as Buffer;
    const sig = req.headers["x-hub-signature-256"] as string | undefined;
    const event = req.headers["x-github-event"] as string | undefined;

    if (!verifyGithubSignature(secret, raw, sig)) {
      req.log.warn({ event }, "invalid github webhook signature");
      return reply.code(401).send({ ok: false });
    }

    let payload: any;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      return reply.code(400).send({ ok: false });
    }

    req.log.info({ event, action: payload?.action, repo: payload?.repository?.full_name }, "github webhook");

    if (event === "pull_request") {
      const action = payload?.action;
      const pr = payload?.pull_request;
      const repoInfo = payload?.repository;
      const owner = repoInfo?.owner?.login || pr?.base?.repo?.owner?.login || pr?.head?.repo?.owner?.login;
      const repo = repoInfo?.name || pr?.base?.repo?.name || pr?.head?.repo?.name;
      const prUrl = pr?.html_url;
      const author = pr?.user?.login;
      const bodyText = [pr?.title || "", pr?.body || ""].join("\n");

      const shouldHandle = ["opened", "edited", "reopened", "ready_for_review", "synchronize"].includes(action);
      if (!shouldHandle || !pr || !owner || !repo || !prUrl) {
        return { ok: true };
      }

      const issueUrls = extractIssueReferences(bodyText, owner, repo);
      if (issueUrls.length === 0) {
        return { ok: true };
      }

      const prisma = getPrisma();
      const chainId = Number(process.env.CHAIN_ID || "0");
      const contractAddress = (process.env.CONTRACT_ADDRESS || "").toLowerCase();

      const bountyMatches: Array<{ issueUrl: string; bountyId: string }> = [];
      for (const issueUrl of issueUrls) {
        const alt = issueUrl.replace(/^https?:\/\//, "");
        const bounty = await prisma.bounty.findFirst({
          where: {
            metadataURI: { in: [issueUrl, alt] },
            ...(chainId ? { chainId } : {}),
            ...(contractAddress ? { contractAddress } : {})
          }
        });
        if (bounty) bountyMatches.push({ issueUrl, bountyId: bounty.bountyId });
      }

      if (bountyMatches.length === 0) {
        return { ok: true };
      }

      const mention = author ? `@${author}` : "there";
      const lines = [
        COMMENT_MARKER,
        `Hey ${mention} — this PR references bounty issue(s):`,
        ...bountyMatches.map((match) => `- ${match.issueUrl}`),
        "",
        "If you're the implementer, please claim the bounty at http://localhost:3000/ and submit this PR URL."
      ];

      try {
        for (const match of bountyMatches) {
          await prisma.linkedPullRequest.upsert({
            where: { bountyId_prUrl: { bountyId: match.bountyId, prUrl } },
            create: { bountyId: match.bountyId, prUrl, author: author ?? null },
            update: { author: author ?? null }
          });
        }
        if (!opts.github) {
          req.log.warn("github auth not configured; skipping PR comment");
          return { ok: true };
        }

        await postPullRequestCommentIfMissing({
          github: opts.github,
          prUrl,
          body: lines.join("\n"),
          marker: COMMENT_MARKER
        });
      } catch (err: any) {
        req.log.warn({ err: err?.message ?? String(err) }, "failed to post PR bounty comment");
      }
    }

    return { ok: true };
  });
}
