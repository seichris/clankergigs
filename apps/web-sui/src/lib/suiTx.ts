import { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiAddress } from "@mysten/sui/utils";

function unresolvedObject(objectId: string, mutable?: boolean) {
  return {
    $kind: "UnresolvedObject" as const,
    UnresolvedObject: {
      objectId: normalizeSuiAddress(objectId),
      mutable,
    },
  };
}

function clockObject(clockObjectId?: string) {
  // If the clock id is unset, prefer the SDK's built-in helper.
  if (!clockObjectId) return null;
  return {
    $kind: "UnresolvedObject" as const,
    UnresolvedObject: {
      objectId: normalizeSuiAddress(clockObjectId),
      initialSharedVersion: 1,
      mutable: false,
    },
  };
}

export function buildCreateBountyTx(input: {
  packageId: string;
  repo: string;
  issueNumber: number;
  issueUrl: string;
}) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${input.packageId}::gh_bounties::create_bounty`,
    arguments: [tx.pure.string(input.repo), tx.pure.u64(BigInt(input.issueNumber)), tx.pure.string(input.issueUrl)],
  });
  return tx;
}

export function buildFundBountyTx(input: {
  packageId: string;
  bountyObjectId: string;
  amountMist: bigint;
  lockSeconds: bigint;
  clockObjectId?: string;
}) {
  const tx = new Transaction();
  const payment = tx.splitCoins(tx.gas, [input.amountMist])[0];
  tx.moveCall({
    target: `${input.packageId}::gh_bounties::fund_bounty`,
    arguments: [
      tx.object(unresolvedObject(input.bountyObjectId, true)),
      payment,
      tx.pure.u64(input.lockSeconds),
      tx.object(clockObject(input.clockObjectId) ?? tx.object.clock()),
    ],
  });
  return tx;
}

export function buildSubmitClaimTx(input: {
  packageId: string;
  bountyObjectId: string;
  claimUrl: string;
  clockObjectId?: string;
}) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${input.packageId}::gh_bounties::submit_claim`,
    arguments: [
      tx.object(unresolvedObject(input.bountyObjectId, false)),
      tx.pure.string(input.claimUrl),
      tx.object(clockObject(input.clockObjectId) ?? tx.object.clock()),
    ],
  });
  return tx;
}

export function buildPayoutTx(input: {
  packageId: string;
  bountyObjectId: string;
  recipient: string;
  amountMist: bigint;
}) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${input.packageId}::gh_bounties::payout`,
    arguments: [
      tx.object(unresolvedObject(input.bountyObjectId, true)),
      tx.pure.address(input.recipient),
      tx.pure.u64(input.amountMist),
    ],
  });
  return tx;
}

export function buildRefundTx(input: {
  packageId: string;
  bountyObjectId: string;
  receiptObjectId: string;
  clockObjectId?: string;
}) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${input.packageId}::gh_bounties::refund`,
    arguments: [
      tx.object(unresolvedObject(input.bountyObjectId, true)),
      tx.object(unresolvedObject(input.receiptObjectId, true)),
      tx.object(clockObject(input.clockObjectId) ?? tx.object.clock()),
    ],
  });
  return tx;
}

