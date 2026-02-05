import { getPrisma } from "../db.js";
import { getObject, queryEventsByPackage, type SuiEvent, type SuiEventId } from "../rpc.js";
import type { Env } from "../env.js";

function toBigIntSafe(value: unknown) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.floor(value));
  if (typeof value === "string" && value.trim().length > 0) {
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }
  return null;
}

function parseEventSeq(seq: string | undefined) {
  const n = Number(seq || "0");
  return Number.isFinite(n) ? n : 0;
}

type MoveStringObject = { bytes: string | number[] };

function isMoveStringObject(value: unknown): value is MoveStringObject {
  if (!value || typeof value !== "object") return false;
  if (!("bytes" in value)) return false;
  const bytes = (value as { bytes?: unknown }).bytes;
  return typeof bytes === "string" || Array.isArray(bytes);
}

function moveString(value: unknown) {
  if (typeof value === "string") return value;
  if (!isMoveStringObject(value)) return "";
  const bytes = value.bytes;

  try {
    if (typeof bytes === "string") {
      if (bytes.startsWith("0x")) return Buffer.from(bytes.slice(2), "hex").toString("utf8");
      return Buffer.from(bytes, "base64").toString("utf8");
    }
    if (Array.isArray(bytes)) return Buffer.from(Uint8Array.from(bytes)).toString("utf8");
  } catch {
    // ignore
  }

  return "";
}

async function readStringFieldFromObject(env: Env, objectId: string, field: string) {
  const obj = await getObject({ rpcUrl: env.SUI_RPC_URL, objectId });
  const fields = obj?.data?.content?.fields || null;
  const v = fields ? (fields as Record<string, unknown>)[field] : null;
  return moveString(v);
}

async function upsertBountyFromObject(env: Env, bountyObjectId: string, packageId: string) {
  const prisma = getPrisma();
  const obj = await getObject({ rpcUrl: env.SUI_RPC_URL, objectId: bountyObjectId });
  const fields = obj?.data?.content?.fields || null;
  const repo = moveString(fields?.repo);
  const issueUrl = moveString(fields?.issue_url);
  const issueNumber = Number(fields?.issue_number ?? 0);
  const admin = typeof fields?.admin === "string" ? fields.admin : "";
  const statusRaw = fields?.status;
  const status = typeof statusRaw === "number" ? String(statusRaw) : typeof statusRaw === "string" ? statusRaw : "0";

  await prisma.bounty.upsert({
    where: { bountyObjectId },
    create: {
      bountyObjectId,
      packageId,
      repo,
      issueUrl,
      issueNumber: Number.isFinite(issueNumber) ? issueNumber : 0,
      admin,
      status
    },
    update: { repo, issueUrl, issueNumber: Number.isFinite(issueNumber) ? issueNumber : 0, admin, status, packageId }
  });
}

async function bumpBountyTotals(bountyObjectId: string, delta: { fundedMist?: bigint; escrowedMist?: bigint; paidMist?: bigint }) {
  const prisma = getPrisma();
  const existing = await prisma.bounty.findUnique({ where: { bountyObjectId } });
  if (!existing) return;
  const funded0 = BigInt(existing.fundedMist || "0");
  const escrow0 = BigInt(existing.escrowedMist || "0");
  const paid0 = BigInt(existing.paidMist || "0");

  const funded = funded0 + (delta.fundedMist ?? 0n);
  const escrowed = escrow0 + (delta.escrowedMist ?? 0n);
  const paid = paid0 + (delta.paidMist ?? 0n);

  await prisma.bounty.update({
    where: { bountyObjectId },
    data: { fundedMist: funded.toString(), escrowedMist: escrowed.toString(), paidMist: paid.toString() }
  });
}

async function handleEvent(env: Env, ev: SuiEvent) {
  const prisma = getPrisma();
  const txDigest = ev.id?.txDigest || "";
  const eventSeqStr = ev.id?.eventSeq || "0";
  const eventSeq = parseEventSeq(eventSeqStr);
  const timestampMs = toBigIntSafe(ev.timestampMs ?? null);

  const parsed: Record<string, unknown> =
    ev.parsedJson && typeof ev.parsedJson === "object" ? (ev.parsedJson as Record<string, unknown>) : {};

  const getStr = (key: string) => {
    const v = parsed[key];
    return typeof v === "string" ? v : "";
  };

  if (ev.type.endsWith("::BountyCreated")) {
    const bountyObjectId = getStr("bounty_id") || getStr("bountyId");
    if (!bountyObjectId) return;
    await upsertBountyFromObject(env, bountyObjectId, ev.packageId || env.SUI_PACKAGE_ID);
    return;
  }

  if (ev.type.endsWith("::BountyFunded")) {
    const bountyObjectId = getStr("bounty_id");
    const receiptObjectId = getStr("receipt_id");
    const funder = getStr("funder") || (ev.sender || "");
    const amountMist = toBigIntSafe(parsed["amount_mist"]) ?? 0n;
    const lockedUntilMs = toBigIntSafe(parsed["locked_until_ms"]) ?? 0n;
    if (!bountyObjectId || !receiptObjectId || !funder) return;

    await prisma.funding.upsert({
      where: { txDigest_eventSeq: { txDigest, eventSeq } },
      create: {
        bountyObjectId,
        receiptObjectId,
        funder: funder.toLowerCase(),
        amountMist: amountMist.toString(),
        lockedUntilMs,
        txDigest,
        eventSeq,
        timestampMs: timestampMs ?? undefined
      },
      update: {
        bountyObjectId,
        receiptObjectId,
        funder: funder.toLowerCase(),
        amountMist: amountMist.toString(),
        lockedUntilMs,
        timestampMs: timestampMs ?? undefined
      }
    });
    await bumpBountyTotals(bountyObjectId, { fundedMist: amountMist, escrowedMist: amountMist });
    return;
  }

  if (ev.type.endsWith("::Payout")) {
    const bountyObjectId = getStr("bounty_id");
    const recipient = getStr("recipient");
    const amountMist = toBigIntSafe(parsed["amount_mist"]) ?? 0n;
    if (!bountyObjectId || !recipient) return;

    await prisma.payout.upsert({
      where: { txDigest_eventSeq: { txDigest, eventSeq } },
      create: {
        bountyObjectId,
        recipient: recipient.toLowerCase(),
        amountMist: amountMist.toString(),
        txDigest,
        eventSeq,
        timestampMs: timestampMs ?? undefined
      },
      update: { bountyObjectId, recipient: recipient.toLowerCase(), amountMist: amountMist.toString(), timestampMs: timestampMs ?? undefined }
    });
    await bumpBountyTotals(bountyObjectId, { escrowedMist: -amountMist, paidMist: amountMist });
    return;
  }

  if (ev.type.endsWith("::Refund")) {
    const bountyObjectId = getStr("bounty_id");
    const funder = getStr("funder");
    const amountMist = toBigIntSafe(parsed["amount_mist"]) ?? 0n;
    if (!bountyObjectId || !funder) return;

    await prisma.refund.upsert({
      where: { txDigest_eventSeq: { txDigest, eventSeq } },
      create: {
        bountyObjectId,
        funder: funder.toLowerCase(),
        amountMist: amountMist.toString(),
        txDigest,
        eventSeq,
        timestampMs: timestampMs ?? undefined
      },
      update: { bountyObjectId, funder: funder.toLowerCase(), amountMist: amountMist.toString(), timestampMs: timestampMs ?? undefined }
    });
    await bumpBountyTotals(bountyObjectId, { escrowedMist: -amountMist });
    return;
  }

  if (ev.type.endsWith("::ClaimSubmitted")) {
    const bountyObjectId = getStr("bounty_id");
    const claimObjectId = getStr("claim_id");
    const claimer = getStr("claimer") || (ev.sender || "");
    if (!bountyObjectId || !claimObjectId || !claimer) return;

    const claimUrl = await readStringFieldFromObject(env, claimObjectId, "claim_url").catch(() => "");

    await prisma.claim.upsert({
      where: { txDigest_eventSeq: { txDigest, eventSeq } },
      create: {
        bountyObjectId,
        claimObjectId,
        claimer: claimer.toLowerCase(),
        claimUrl,
        txDigest,
        eventSeq,
        timestampMs: timestampMs ?? undefined
      },
      update: { bountyObjectId, claimObjectId, claimer: claimer.toLowerCase(), claimUrl, timestampMs: timestampMs ?? undefined }
    });
  }
}

type Logger = { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };

export async function startIndexer(env: Env, logger: Logger) {
  const prisma = getPrisma();

  async function tick() {
    const state = await prisma.indexerState.findUnique({ where: { packageId: env.SUI_PACKAGE_ID } });
    const cursor: SuiEventId | null =
      state?.cursorTx && typeof state?.cursorSeq === "number"
        ? { txDigest: state.cursorTx, eventSeq: String(state.cursorSeq) }
        : null;

    const page = await queryEventsByPackage({
      rpcUrl: env.SUI_RPC_URL,
      packageId: env.SUI_PACKAGE_ID,
      cursor,
      limit: env.SUI_EVENT_PAGE_SIZE
    });

    if (!page?.data || page.data.length === 0) return;

    for (const ev of page.data) {
      try {
        await handleEvent(env, ev);
      } catch (err) {
        logger.warn({ err, type: ev.type, id: ev.id }, "failed to handle event");
      }
    }

    const last = page.data[page.data.length - 1];
    const lastTx = last?.id?.txDigest || null;
    const lastSeq = parseEventSeq(last?.id?.eventSeq);
    if (lastTx) {
      await prisma.indexerState.upsert({
        where: { packageId: env.SUI_PACKAGE_ID },
        create: { packageId: env.SUI_PACKAGE_ID, cursorTx: lastTx, cursorSeq: lastSeq },
        update: { cursorTx: lastTx, cursorSeq: lastSeq }
      });
    }
  }

  // Run once immediately.
  await tick().catch((err) => logger.error({ err }, "indexer tick failed"));
  // Poll forever.
  setInterval(() => {
    tick().catch((err) => logger.error({ err }, "indexer tick failed"));
  }, env.SUI_POLL_INTERVAL_MS);

  logger.info({ packageId: env.SUI_PACKAGE_ID, rpcUrl: env.SUI_RPC_URL }, "sui indexer started");
}
