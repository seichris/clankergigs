import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseUnits, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { getPrisma } from "../db.js";
import { createGatewayClient } from "../circle/gateway.js";
import { parseGithubIssueUrl } from "../github/parse.js";
import { resolveGithubAuthFromRequest } from "../auth/sessions.js";
import { gatewayMintOnArc } from "./arcMint.js";
import { GATEWAY_DOMAIN_BY_CHAIN_ID, addressToBytes32, getSupportedSourceChains } from "./config.js";
import { loadTreasuryEnvFromProcess } from "./env.js";
import { BurnIntentSchema, buildBurnIntentTypedData, buildDestinationPartyBytes32, buildSourcePartyBytes32, randomSalt32, type BurnIntent } from "./typedData.js";

const BountyIdSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

function pickGatewayDomain(info: { domains: Array<{ domain: string; walletContract: string; minterContract: string }> }, domainId: number) {
  return info.domains.find((d) => Number(d.domain) === domainId);
}

async function ensureRepoAdmin(opts: { githubToken: string; owner: string; repo: string }) {
  const ghHeaders = {
    Accept: "application/vnd.github+json",
    "User-Agent": "gh-bounties"
  } as Record<string, string>;

  let ghRes = await fetch(`https://api.github.com/repos/${opts.owner}/${opts.repo}`, {
    headers: { ...ghHeaders, Authorization: `Bearer ${opts.githubToken}` }
  });
  if (ghRes.status === 401) {
    ghRes = await fetch(`https://api.github.com/repos/${opts.owner}/${opts.repo}`, {
      headers: { ...ghHeaders, Authorization: `token ${opts.githubToken}` }
    });
  }
  if (!ghRes.ok) {
    const text = await ghRes.text().catch(() => "");
    if (ghRes.status === 401) {
      throw new Error("GitHub session expired or invalid. Please reconnect GitHub.");
    }
    throw new Error(`GitHub API error (${ghRes.status}): ${text || ghRes.statusText}`);
  }
  const ghData = (await ghRes.json()) as any;
  if (!ghData?.permissions?.admin) throw new Error("GitHub user is not a repo admin");
}

export function registerTreasuryRoutes(app: FastifyInstance) {
  app.get("/treasury/config", async (req, reply) => {
    try {
      const env = loadTreasuryEnvFromProcess();
      if (!env.enabled) {
        return reply.send({ enabled: false });
      }
      const gateway = createGatewayClient({ baseUrl: env.gatewayApiUrl });
      const info = await gateway.getInfo();
      const destinationDomain = pickGatewayDomain(info, env.arc.domain);
      if (!destinationDomain?.minterContract) {
        return reply.code(502).send({ error: "Gateway info missing destination minter contract" });
      }

      const supportedSources = getSupportedSourceChains()
        .map((c) => {
          const domain = pickGatewayDomain(info, c.gatewaySourceDomain);
          if (!domain?.walletContract) return null;
          return { ...c, walletContract: domain.walletContract };
        })
        .filter(Boolean);

      return reply.send({
        enabled: true,
        gateway: {
          apiUrl: env.gatewayApiUrl,
          destinationMinterContract: destinationDomain.minterContract,
          supportedSources
        },
        arc: { chainId: env.arc.chainId, rpcUrl: env.arc.rpcUrl, domain: env.arc.domain, usdcAddress: env.arc.usdcAddress },
        treasury: { address: env.treasuryAddress }
      });
    } catch (err: any) {
      return reply.code(500).send({ error: err?.message ?? String(err) });
    }
  });

  app.get("/treasury/admin", async (req, reply) => {
    const env = loadTreasuryEnvFromProcess();
    if (!env.enabled) return reply.code(404).send({ error: "Treasury disabled" });

    const q = req.query as { bountyId?: string };
    if (!q.bountyId) return reply.code(400).send({ error: "Missing bountyId" });

    const { githubToken } = await resolveGithubAuthFromRequest(req);
    if (!githubToken) return reply.code(401).send({ error: "Missing GitHub auth", isAdmin: false });

    const prisma = getPrisma();
    const bounty = await prisma.bounty.findUnique({ where: { bountyId: q.bountyId } });
    if (!bounty) return reply.code(404).send({ error: "Unknown bountyId", isAdmin: false });

    let owner: string;
    let repo: string;
    try {
      const parsedIssue = parseGithubIssueUrl(bounty.metadataURI);
      owner = parsedIssue.owner;
      repo = parsedIssue.repo;
    } catch {
      return reply.code(400).send({ error: `Bounty metadataURI is not a GitHub issue URL: ${bounty.metadataURI}`, isAdmin: false });
    }

    try {
      await ensureRepoAdmin({ githubToken, owner, repo });
      return reply.send({ isAdmin: true });
    } catch (err: any) {
      return reply.code(403).send({ error: err?.message ?? String(err), isAdmin: false });
    }
  });

  app.post("/treasury/funding-intents", async (req, reply) => {
    const env = loadTreasuryEnvFromProcess();
    if (!env.enabled) return reply.code(404).send({ error: "Treasury disabled" });

    const Body = z.object({
      bountyId: BountyIdSchema,
      amountUsdc: z.string().min(1),
      sourceChainId: z.coerce.number().int().positive(),
      sender: AddressSchema
    });

    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten().fieldErrors });
    const { bountyId, amountUsdc, sourceChainId, sender } = parsed.data;

    const sourceCfg = GATEWAY_DOMAIN_BY_CHAIN_ID[sourceChainId];
    if (!sourceCfg) return reply.code(400).send({ error: `Unsupported sourceChainId: ${sourceChainId}` });

    const usdc = getSupportedSourceChains().find((c) => c.chainId === sourceChainId)?.usdcAddress;
    if (!usdc) return reply.code(400).send({ error: `USDC not configured for chainId ${sourceChainId}` });

    const prisma = getPrisma();
    const bounty = await prisma.bounty.findUnique({ where: { bountyId } });
    if (!bounty) return reply.code(404).send({ error: "Unknown bountyId (not indexed yet)" });

    let valueSubunits: bigint;
    try {
      valueSubunits = parseUnits(amountUsdc, 6);
    } catch {
      return reply.code(400).send({ error: "Invalid amountUsdc" });
    }
    if (valueSubunits <= 0n) return reply.code(400).send({ error: "amountUsdc must be > 0" });

    const destinationCallerAddress = env.destinationCallerAddress;

    const gateway = createGatewayClient({ baseUrl: env.gatewayApiUrl });
    let info: Awaited<ReturnType<typeof gateway.getInfo>>;
    try {
      info = await gateway.getInfo();
    } catch (err: any) {
      return reply.code(502).send({ error: `Gateway info failed: ${err?.message ?? String(err)}` });
    }
    const sourceDomainInfo = pickGatewayDomain(info, sourceCfg.domain);
    const destinationDomainInfo = pickGatewayDomain(info, env.arc.domain);
    if (!sourceDomainInfo?.walletContract) {
      return reply.code(502).send({ error: "Gateway info missing source wallet contract" });
    }
    if (!destinationDomainInfo?.minterContract) {
      return reply.code(502).send({ error: "Gateway info missing destination minter contract" });
    }

    const transferSpec = {
      version: 1,
      sourceDomain: sourceCfg.domain,
      destinationDomain: env.arc.domain,
      sourceContract: addressToBytes32(sourceDomainInfo.walletContract as Address),
      destinationContract: addressToBytes32(destinationDomainInfo.minterContract as Address),
      sourceToken: addressToBytes32(usdc),
      destinationToken: addressToBytes32(env.arc.usdcAddress),
      ...buildSourcePartyBytes32(sender as Address),
      ...buildDestinationPartyBytes32({ treasuryAddress: env.treasuryAddress, destinationCaller: destinationCallerAddress }),
      value: valueSubunits.toString(),
      salt: randomSalt32(),
      hookData: "0x"
    };

    let burnIntent: BurnIntent;
    try {
      const estimate = await gateway.estimate({ spec: transferSpec as any });
      burnIntent = BurnIntentSchema.parse(estimate.burnIntent);
    } catch (err: any) {
      return reply.code(502).send({ error: `Gateway estimate failed: ${err?.message ?? String(err)}` });
    }

    const intent = await prisma.treasuryFundingIntent.create({
      data: {
        bountyId,
        sender: sender.toLowerCase(),
        sourceChainId,
        amountUsdc: valueSubunits.toString(),
        status: "created",
        burnIntentJson: JSON.stringify(burnIntent)
      }
    });

    await prisma.treasuryBountyLedger.upsert({
      where: { bountyId },
      create: { bountyId },
      update: {}
    });

    return reply.send({
      intentId: intent.id,
      deposit: { chainId: sourceChainId, usdcAddress: usdc, gatewayWalletContract: sourceDomainInfo.walletContract },
      burnIntent,
      typedData: buildBurnIntentTypedData(burnIntent),
      treasury: { arcAddress: env.treasuryAddress, destinationCaller: destinationCallerAddress }
    });
  });

  app.post("/treasury/funding-intents/:id/submit-signature", async (req, reply) => {
    const env = loadTreasuryEnvFromProcess();
    if (!env.enabled) return reply.code(404).send({ error: "Treasury disabled" });

    const Params = z.object({ id: z.string().min(1) });
    const Body = z.object({ signature: z.string().regex(/^0x[a-fA-F0-9]+$/) });
    const p = Params.safeParse(req.params);
    const b = Body.safeParse(req.body);
    if (!p.success || !b.success) return reply.code(400).send({ error: "Invalid request" });

    const prisma = getPrisma();
    const intent = await prisma.treasuryFundingIntent.findUnique({ where: { id: p.data.id } });
    if (!intent) return reply.code(404).send({ error: "Unknown intent" });
    if (!intent.burnIntentJson) return reply.code(400).send({ error: "Missing burnIntent" });
    if (intent.status !== "created") return reply.code(409).send({ error: `Intent is ${intent.status}` });

    const burnIntent = BurnIntentSchema.parse(JSON.parse(intent.burnIntentJson));
    const typedData = buildBurnIntentTypedData(burnIntent) as any;

    let recovered: Address;
    try {
      recovered = (await recoverTypedDataAddress({
        ...typedData,
        signature: b.data.signature as Hex
      })) as Address;
    } catch (err: any) {
      return reply.code(400).send({ error: `Signature recovery failed: ${err?.message ?? String(err)}` });
    }
    if (recovered.toLowerCase() !== intent.sender.toLowerCase()) {
      return reply.code(400).send({ error: "Signature does not match sender" });
    }

    const gateway = createGatewayClient({ baseUrl: env.gatewayApiUrl });
    let att: { attestation: Hex; signature: Hex };
    try {
      att = await gateway.transfer({ burnIntent: burnIntent as any, signature: b.data.signature as Hex });
    } catch (err: any) {
      return reply.code(502).send({ error: `Gateway transfer failed: ${err?.message ?? String(err)}` });
    }

    await prisma.treasuryFundingIntent.update({
      where: { id: intent.id },
      data: {
        burnIntentSignature: b.data.signature,
        gatewayAttestation: att.attestation,
        gatewayAttestationSignature: att.signature,
        status: "transfer_submitted"
      }
    });

    return reply.send({ ok: true, status: "transfer_submitted" });
  });

  app.post("/treasury/funding-intents/:id/mint", async (req, reply) => {
    const env = loadTreasuryEnvFromProcess();
    if (!env.enabled) return reply.code(404).send({ error: "Treasury disabled" });

    const Params = z.object({ id: z.string().min(1) });
    const p = Params.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "Invalid params" });

    const prisma = getPrisma();
    const intent = await prisma.treasuryFundingIntent.findUnique({ where: { id: p.data.id } });
    if (!intent) return reply.code(404).send({ error: "Unknown intent" });
    if (intent.status !== "transfer_submitted") return reply.code(409).send({ error: `Intent is ${intent.status}` });
    if (!intent.gatewayAttestation || !intent.gatewayAttestationSignature) return reply.code(400).send({ error: "Missing attestation" });

    let mintHash: Hex;
    try {
      const gateway = createGatewayClient({ baseUrl: env.gatewayApiUrl });
      const info = await gateway.getInfo();
      const destinationDomainInfo = pickGatewayDomain(info, env.arc.domain);
      if (!destinationDomainInfo?.minterContract) {
        return reply.code(502).send({ error: "Gateway info missing destination minter contract" });
      }
      const minted = await gatewayMintOnArc({
        rpcUrl: env.arc.rpcUrl,
        chainId: env.arc.chainId,
        minterContract: destinationDomainInfo.minterContract as Address,
        destinationCallerPrivateKey: env.destinationCallerPrivateKey,
        attestation: intent.gatewayAttestation as Hex,
        signature: intent.gatewayAttestationSignature as Hex
      });
      mintHash = minted.hash;
    } catch (err: any) {
      await prisma.treasuryFundingIntent.update({ where: { id: intent.id }, data: { status: "failed", error: err?.message ?? String(err) } });
      return reply.code(502).send({ error: `Arc mint failed: ${err?.message ?? String(err)}` });
    }

    const amount = BigInt(intent.amountUsdc || "0");
    await prisma.$transaction(async (tx) => {
      await tx.treasuryFundingIntent.update({
        where: { id: intent.id },
        data: { status: "credited", arcMintTxHash: mintHash }
      });
      const ledger = await tx.treasuryBountyLedger.upsert({
        where: { bountyId: intent.bountyId },
        create: { bountyId: intent.bountyId },
        update: {}
      });
      const nextTotalFunded = (BigInt(ledger.totalFundedUsdc) + amount).toString();
      const nextAvailable = (BigInt(ledger.availableUsdc) + amount).toString();
      await tx.treasuryBountyLedger.update({
        where: { bountyId: intent.bountyId },
        data: { totalFundedUsdc: nextTotalFunded, availableUsdc: nextAvailable }
      });
    });

    return reply.send({ ok: true, status: "credited", arcMintTxHash: mintHash });
  });

  app.get("/treasury/funding-intents", async (req) => {
    const q = req.query as { bountyId?: string };
    const prisma = getPrisma();
    const where: any = {};
    if (q.bountyId) where.bountyId = q.bountyId;
    const intents = await prisma.treasuryFundingIntent.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 });
    return { intents };
  });

  app.get("/treasury/ledger", async (req) => {
    const q = req.query as { bountyId?: string };
    const prisma = getPrisma();
    if (q.bountyId) {
      const ledger = await prisma.treasuryBountyLedger.findUnique({ where: { bountyId: q.bountyId } });
      return { ledger };
    }
    const ledgers = await prisma.treasuryBountyLedger.findMany({ orderBy: { updatedAt: "desc" }, take: 200 });
    return { ledgers };
  });

  app.post("/treasury/payout-intents", async (req, reply) => {
    const env = loadTreasuryEnvFromProcess();
    if (!env.enabled) return reply.code(404).send({ error: "Treasury disabled" });

    const Body = z.object({
      bountyId: BountyIdSchema,
      recipient: AddressSchema,
      destinationChain: z.string().min(1),
      amountUsdc: z.string().min(1)
    });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten().fieldErrors });

    const { githubToken } = await resolveGithubAuthFromRequest(req);
    if (!githubToken) return reply.code(401).send({ error: "Missing GitHub auth" });

    const prisma = getPrisma();
    const bounty = await prisma.bounty.findUnique({ where: { bountyId: parsed.data.bountyId } });
    if (!bounty) return reply.code(404).send({ error: "Unknown bountyId" });

    let owner: string;
    let repo: string;
    try {
      const parsedIssue = parseGithubIssueUrl(bounty.metadataURI);
      owner = parsedIssue.owner;
      repo = parsedIssue.repo;
    } catch {
      return reply.code(400).send({ error: `Bounty metadataURI is not a GitHub issue URL: ${bounty.metadataURI}` });
    }

    try {
      await ensureRepoAdmin({ githubToken, owner, repo });
    } catch (err: any) {
      return reply.code(403).send({ error: err?.message ?? String(err) });
    }

    let amount: bigint;
    try {
      amount = parseUnits(parsed.data.amountUsdc, 6);
    } catch {
      return reply.code(400).send({ error: "Invalid amountUsdc" });
    }
    if (amount <= 0n) return reply.code(400).send({ error: "amountUsdc must be > 0" });

    const ledger = await prisma.treasuryBountyLedger.findUnique({ where: { bountyId: parsed.data.bountyId } });
    const available = BigInt(ledger?.availableUsdc ?? "0");
    if (available < amount) return reply.code(400).send({ error: "Insufficient treasury balance for this bounty" });

    const payout = await prisma.$transaction(async (tx) => {
      const created = await tx.treasuryPayoutIntent.create({
        data: {
          bountyId: parsed.data.bountyId,
          recipient: parsed.data.recipient.toLowerCase(),
          destinationChain: parsed.data.destinationChain,
          amountUsdc: amount.toString(),
          status: "created"
        }
      });
      await tx.treasuryBountyLedger.update({
        where: { bountyId: parsed.data.bountyId },
        data: { availableUsdc: (available - amount).toString() }
      });
      return created;
    });

    return reply.send({ payoutIntentId: payout.id, status: payout.status });
  });

  app.get("/treasury/payout-intents", async (req) => {
    const q = req.query as { bountyId?: string };
    const prisma = getPrisma();
    const where: any = {};
    if (q.bountyId) where.bountyId = q.bountyId;
    const intents = await prisma.treasuryPayoutIntent.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 });
    return { intents };
  });
}
