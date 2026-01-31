import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";

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

export function registerGithubWebhookRoutes(app: FastifyInstance, opts: { webhookSecret?: string }) {
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

    // MVP: accept and log. Next step: label automation + linking PRs to bounties.
    req.log.info({ event, action: payload?.action, repo: payload?.repository?.full_name }, "github webhook");
    return { ok: true };
  });
}
