import { loadEnv } from "./env.js";
import { buildServer } from "./server.js";
import { startIndexer } from "./indexer/indexer.js";
import { createPublicClient, http, isAddress, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseGithubIssueUrl } from "./github/parse.js";
import { getGithubAccessTokenFromRequest } from "./github/oauth.js";

async function main() {
  const env = loadEnv();
  // Prisma reads DATABASE_URL from process.env at construction time.
  process.env.DATABASE_URL ||= env.DATABASE_URL;

  const app = await buildServer();

  // Payout authorization: verify GitHub admin and sign an EIP-712 authorization.
  if (env.CONTRACT_ADDRESS && env.CONTRACT_ADDRESS.length > 0 && env.BACKEND_SIGNER_PRIVATE_KEY && env.BACKEND_SIGNER_PRIVATE_KEY.length > 0) {
    const client = createPublicClient({ transport: http(env.RPC_URL) });
    const signer = privateKeyToAccount(env.BACKEND_SIGNER_PRIVATE_KEY as Hex);

    const authAbi = parseAbi([
      "function payoutNonces(bytes32 bountyId) view returns (uint256)",
      "function bounties(bytes32 bountyId) view returns (bytes32 repoHash, uint256 issueNumber, uint8 status, uint64 createdAt, string metadataURI)"
    ]);

    app.post("/payout-auth", async (req, reply) => {
      // Preferred: GitHub OAuth login via HttpOnly session cookie.
      // Back-compat: allow Authorization: Bearer <token> for local testing / scripts.
      const auth = req.headers.authorization || "";
      const m = auth.match(/^Bearer\s+(.+)$/i);
      const githubToken = (m?.[1]?.trim() || "") || getGithubAccessTokenFromRequest(req) || "";
      if (!githubToken) return reply.code(401).send({ error: "Not logged in (use GitHub OAuth login or send Authorization: Bearer <token>)" });

      // Be tolerant of mis-parsed JSON bodies (e.g. body arrives as a string).
      const rawBody = req.body as any;
      let body: any = rawBody;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          body = null;
        }
      }
      // Some clients/content-type parsers may deliver JSON as a Buffer/Uint8Array.
      if (body && typeof body === "object" && (Buffer.isBuffer(body) || body instanceof Uint8Array)) {
        try {
          const text = Buffer.from(body).toString("utf8");
          body = JSON.parse(text);
        } catch {
          req.log.warn(
            {
              contentType: req.headers["content-type"],
              contentLength: req.headers["content-length"]
            },
            "Failed to parse JSON buffer body"
          );
          body = null;
        }
      }

      if (!body || typeof body !== "object") {
        req.log.warn(
          {
            contentType: req.headers["content-type"],
            contentLength: req.headers["content-length"],
            bodyType: typeof rawBody
          },
          "Invalid /payout-auth body"
        );
        return reply.code(400).send({ error: "Invalid JSON body" });
      }

      const bountyIdRaw = body?.bountyId as unknown;
      const token = body?.token as Address | undefined;
      const recipient = body?.recipient as Address | undefined;
      const amountWeiStr = body?.amountWei as string | undefined;
      const deadlineStr = body?.deadline as string | undefined;

      let bountyIdStr = typeof bountyIdRaw === "string" ? bountyIdRaw.trim() : "";
      // Accept both `0x`-prefixed and bare 32-byte hex strings.
      if (/^[a-fA-F0-9]{64}$/.test(bountyIdStr)) bountyIdStr = `0x${bountyIdStr}`;
      if (!/^0x[a-fA-F0-9]{64}$/.test(bountyIdStr)) {
        req.log.warn({ received: bountyIdRaw, type: typeof bountyIdRaw }, "Invalid bountyId");
        return reply.code(400).send({ error: "Invalid bountyId", received: bountyIdRaw ?? null });
      }
      const bountyId = bountyIdStr as Hex;
      if (!token || !isAddress(token)) return reply.code(400).send({ error: "Invalid token address" });
      if (!recipient || !isAddress(recipient)) return reply.code(400).send({ error: "Invalid recipient address" });
      if (!amountWeiStr || !/^\d+$/.test(amountWeiStr)) return reply.code(400).send({ error: "Invalid amountWei" });

      const amountWei = BigInt(amountWeiStr);
      const deadline = deadlineStr && /^\d+$/.test(deadlineStr) ? BigInt(deadlineStr) : BigInt(Math.floor(Date.now() / 1000) + 10 * 60);

      // Helpful debug without leaking secrets.
      req.log.info(
        {
          bountyId,
          token,
          recipient,
          amountWei: amountWei.toString(),
          deadline: deadline.toString()
        },
        "payout-auth request"
      );

      const bounty = (await client.readContract({
        address: env.CONTRACT_ADDRESS as Hex,
        abi: authAbi,
        functionName: "bounties",
        args: [bountyId]
      })) as readonly [Hex, bigint, number, bigint, string];

      const createdAt = BigInt(bounty[3] ?? 0n);
      const issueUrl = (bounty[4] ?? "").toString();
      if (createdAt === 0n) return reply.code(404).send({ error: "Bounty not found on-chain" });

      let owner: string;
      let repo: string;
      try {
        const parsed = parseGithubIssueUrl(issueUrl);
        owner = parsed.owner;
        repo = parsed.repo;
      } catch (e: any) {
        return reply.code(400).send({ error: `Bounty metadataURI is not a GitHub issue URL: ${issueUrl}` });
      }

      // Verify that the caller is an admin on the repo.
      const ghHeaders = {
        Accept: "application/vnd.github+json",
        "User-Agent": "gh-bounties"
      } as Record<string, string>;

      // GitHub classic PATs historically used `token`, while fine-grained and OAuth tokens use `Bearer`.
      let ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: { ...ghHeaders, Authorization: `Bearer ${githubToken}` }
      });
      if (ghRes.status === 401) {
        ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
          headers: { ...ghHeaders, Authorization: `token ${githubToken}` }
        });
      }
      if (!ghRes.ok) {
        const text = await ghRes.text().catch(() => "");
        req.log.warn({ status: ghRes.status, text: text.slice(0, 200) }, "GitHub repo permission check failed");
        return reply.code(403).send({ error: `GitHub API error (${ghRes.status}): ${text || ghRes.statusText}` });
      }
      const ghData = (await ghRes.json()) as any;
      if (!ghData?.permissions?.admin) return reply.code(403).send({ error: "GitHub user is not a repo admin" });

      const nonce = (await client.readContract({
        address: env.CONTRACT_ADDRESS as Hex,
        abi: authAbi,
        functionName: "payoutNonces",
        args: [bountyId]
      })) as bigint;

      const signature = await signer.signTypedData({
        domain: { name: "GHBounties", version: "1", chainId: env.CHAIN_ID, verifyingContract: env.CONTRACT_ADDRESS as Hex },
        types: {
          Payout: [
            { name: "bountyId", type: "bytes32" },
            { name: "token", type: "address" },
            { name: "recipient", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" }
          ]
        },
        primaryType: "Payout",
        message: { bountyId, token, recipient, amount: amountWei, nonce, deadline }
      });

      return reply.send({
        issueUrl,
        owner,
        repo,
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        signature
      });
    });

    app.log.info({ signer: signer.address }, "payout auth enabled");
  } else {
    app.log.warn("payout auth disabled (missing CONTRACT_ADDRESS or BACKEND_SIGNER_PRIVATE_KEY)");
  }

  // Indexer is optional while bootstrapping the UI, but usually you'll set CONTRACT_ADDRESS.
  if (env.CONTRACT_ADDRESS && env.CONTRACT_ADDRESS.length > 0) {
    const githubMode = env.GITHUB_AUTH_MODE ?? "pat";
    const github =
      githubMode === "app"
        ? env.GITHUB_APP_ID && env.GITHUB_INSTALLATION_ID && env.GITHUB_PRIVATE_KEY_PEM
          ? { appId: env.GITHUB_APP_ID, installationId: env.GITHUB_INSTALLATION_ID, privateKeyPem: env.GITHUB_PRIVATE_KEY_PEM }
          : null
        : env.GITHUB_TOKEN && env.GITHUB_TOKEN.length > 0
          ? { userToken: env.GITHUB_TOKEN }
          : null;

    await startIndexer({
      rpcUrl: env.RPC_URL,
      chainId: env.CHAIN_ID,
      contractAddress: (env.CONTRACT_ADDRESS.toLowerCase() as any),
      github
    });
    app.log.info({ contract: env.CONTRACT_ADDRESS, chainId: env.CHAIN_ID }, "indexer started");
  } else {
    app.log.warn("CONTRACT_ADDRESS is empty; indexer disabled");
  }

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
