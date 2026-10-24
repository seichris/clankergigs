import { createHmac } from "node:crypto";
import { backfillLinkedPullRequests } from "../src/github/backfill.js";
import { PR_CLAIM_REMINDER_MARKER } from "../src/github/prReminder.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress, keccak256, toBytes, type Hex } from "viem";
import {
  createNetworkRegistry,
  parseNetworks,
  networkKey,
} from "../src/networks.js";
import { loadEnv } from "../src/env.js";
import { createApplication } from "../src/index.js";
import { getPrisma } from "../src/db.js";
import { indexLog, startIndexer } from "../src/indexer/indexer.js";

const directory = mkdtempSync(join(tmpdir(), "clankergigs-networks-"));
const database = join(directory, "test.db");
process.env.DATABASE_URL = `file:${database}`;
const A = `0x${"ab".repeat(20)}` as Hex;
const B = `0x${"cd".repeat(20)}` as Hex;
const zero = `0x${"00".repeat(20)}` as Hex;
const bountyId = `0x${"01".repeat(32)}` as Hex;
const repoHash = `0x${"02".repeat(32)}` as Hex;
const txHash = `0x${"03".repeat(32)}` as Hex;
const issueUrl = "https://github.com/example/project/issues/12";
const prUrl = "https://github.com/example/project/pull/13";
// Public, deterministic test key, never used on a real network.
const key = `0x${"11".repeat(32)}` as Hex;
const signer = privateKeyToAccount(key);
const configs = [
  {
    chainId: 1,
    contractAddress: A,
    rpcUrls: ["https://secret.invalid/private-provider-token"],
    startBlock: 10,
  },
  {
    chainId: 11155111,
    contractAddress: A,
    rpcUrls: ["http://localhost:1"],
    startBlock: 10,
  },
  {
    chainId: 1,
    contractAddress: B,
    rpcUrls: ["http://localhost:2"],
    startBlock: 10,
  },
];
const networks = createNetworkRegistry(configs);
const reads: Array<{
  deployment: string;
  functionName: string;
  address: string;
}> = [];
let wrongChain = false;
let wrongSigner = false;
let app: Awaited<ReturnType<typeof createApplication>>;
const originalFetch = globalThis.fetch;

before(async () => {
  execFileSync(process.env.PYTHON || "python3", [
    "-c",
    `
import sqlite3,sys
from pathlib import Path
db=sqlite3.connect(sys.argv[1])
for f in sorted(Path(sys.argv[2]).glob('*/migration.sql')): db.executescript(f.read_text())
db.close()
`,
    database,
    resolve("prisma/migrations"),
  ]);
  let i = 0;
  for (const network of networks.values()) {
    const nonce = BigInt(++i);
    network.publicClient = {
      getChainId: async () => (wrongChain ? 999 : network.chainId),
      readContract: async ({ functionName, address }: any) => {
        reads.push({ deployment: network.key, functionName, address });
        assert.equal(address, network.contractAddress);
        if (functionName === "payoutAuthorizer")
          return wrongSigner ? zero : signer.address;
        if (functionName === "bounties")
          return [repoHash, 12n, 0, 1n, issueUrl];
        if (functionName === "escrowed") return 1000n;
        if (functionName.endsWith("Nonces")) return nonce;
        throw new Error(`Unexpected read: ${functionName}`);
      },
    } as any;
  }
  process.env.NETWORKS_JSON = JSON.stringify(configs);
  process.env.BACKEND_SIGNER_PRIVATE_KEY = key;
  process.env.GITHUB_BACKFILL_INTERVAL_MINUTES = "0";
  process.env.GITHUB_WEBHOOK_SECRET = "local-test-webhook-secret";
  app = await createApplication(loadEnv(), { background: false, networks });
  globalThis.fetch = async (input) => {
    const url = String(input);
    assert.ok(
      url.startsWith("https://api.github.com/"),
      `Unexpected external request: ${url}`,
    );
    if (url.includes("/search/issues?"))
      return Response.json({
        items: [{ html_url: prUrl, user: { login: "author" } }],
      });
    if (url.includes("/issues/13/comments"))
      return Response.json([{ body: PR_CLAIM_REMINDER_MARKER }]);
    if (url.endsWith("/user")) return Response.json({ login: "author", id: 1 });
    if (url.endsWith("/pulls/13"))
      return Response.json({ user: { login: "author" } });
    if (url.endsWith("/repos/example/project"))
      return Response.json({ permissions: { admin: true } });
    throw new Error(`Unexpected GitHub request: ${url}`);
  };
});

after(async () => {
  globalThis.fetch = originalFetch;
  await app?.close();
  await getPrisma().$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

test("configuration prefers the registry, normalizes addresses, rejects invalid/duplicate/empty registries", () => {
  const legacy = {
    CHAIN_ID: 31337,
    CONTRACT_ADDRESS: B,
    RPC_URLS: ["http://localhost:8545"],
  };
  assert.equal(parseNetworks(undefined, legacy)[0]?.chainId, 31337);
  assert.equal(parseNetworks(JSON.stringify(configs), legacy).length, 3);
  assert.equal(
    parseNetworks(
      JSON.stringify([
        { ...configs[0], contractAddress: A.toUpperCase().replace("0X", "0x") },
      ]),
      legacy,
    )[0]?.contractAddress,
    A,
  );
  for (const raw of [
    "{",
    "[]",
    "null",
    JSON.stringify([configs[0], configs[0]]),
    JSON.stringify([{ ...configs[0], rpcUrls: [] }]),
  ]) {
    assert.throws(() => parseNetworks(raw, legacy));
  }
});

test("same bounty, claim, transaction and log IDs stay isolated across chains and same-chain contracts; replay is idempotent", async () => {
  let n = 0;
  for (const network of networks.values()) {
    const amount = 100n + BigInt(n++);
    const events = [
      ["RepoRegistered", { repoHash, maintainer: network.contractAddress }],
      [
        "BountyCreated",
        { bountyId, repoHash, issueNumber: 12n, metadataURI: issueUrl },
      ],
      [
        "BountyFunded",
        { bountyId, token: zero, funder: A, amount, lockedUntil: 0n },
      ],
      [
        "ClaimSubmitted",
        { bountyId, claimId: 1n, claimer: A, metadataURI: prUrl },
      ],
      ["PaidOut", { bountyId, token: zero, recipient: A, amount: 30n }],
      ["Refunded", { bountyId, token: zero, funder: A, amount: 10n }],
      ["StatusChanged", { bountyId, status: 1n }],
    ] as const;
    for (let replay = 0; replay < 2; replay++) {
      for (const [logIndex, [eventName, args]] of events.entries()) {
        await indexLog(
          network.publicClient,
          { ...network, github: null },
          {
            eventName,
            args,
            transactionHash: txHash,
            blockNumber: 10n,
            logIndex,
          },
        );
      }
    }
    const bounty = await getPrisma().bounty.findUniqueOrThrow({
      where: {
        bountyId_chainId_contractAddress: {
          bountyId,
          chainId: network.chainId,
          contractAddress: network.contractAddress,
        },
      },
      include: {
        assets: true,
        fundings: true,
        claims: true,
        payouts: true,
        refunds: true,
      },
    });
    assert.equal(bounty.status, "IMPLEMENTED");
    assert.deepEqual(
      [
        bounty.assets[0]?.funded,
        bounty.assets[0]?.escrowed,
        bounty.assets[0]?.paid,
      ],
      [String(amount), String(amount - 40n), "30"],
    );
    for (const children of [
      bounty.fundings,
      bounty.claims,
      bounty.payouts,
      bounty.refunds,
    ]) {
      assert.equal(children.length, 1);
      assert.equal(children[0]?.bountyDbId, bounty.id);
    }
  }
  assert.equal(await getPrisma().bounty.count(), 3);
  const repos = await getPrisma().repoDeployment.findMany();
  assert.equal(repos.length, 3);
  for (const repo of repos)
    assert.equal(repo.maintainerAddress, repo.contractAddress);
});

test("discovery hides RPC credentials; reads return all deployments, filter pairs, and reject ambiguous IDs", async () => {
  const discovery = await app.inject("/networks");
  assert.equal(discovery.statusCode, 200);
  assert.deepEqual(
    discovery.json().networks,
    configs.map(({ chainId, contractAddress }) => ({
      chainId,
      contractAddress,
    })),
  );
  assert.ok(!discovery.body.includes("private-provider-token"));
  assert.equal((await app.inject("/issues")).json().issues.length, 3);
  assert.equal((await app.inject("/bounties")).json().bounties.length, 3);
  assert.equal(
    (await app.inject(`/bounties?bountyId=${bountyId}`)).statusCode,
    409,
  );
  assert.equal((await app.inject(`/issues?chainId=1`)).statusCode, 400);
  assert.equal(
    (await app.inject(`/issues?chainId=999&contractAddress=${A}`)).statusCode,
    404,
  );
  for (const network of networks.values()) {
    const query = `chainId=${network.chainId}&contractAddress=${network.contractAddress}`;
    const issues = (await app.inject(`/issues?${query}`)).json().issues;
    assert.equal(issues.length, 1);
    assert.equal(issues[0].contractAddress, network.contractAddress);
    const bounty = (
      await app.inject(`/bounties?bountyId=${bountyId}&${query}`)
    ).json().bounty;
    assert.equal(bounty.chainId, network.chainId);
    assert.equal(bounty.contractAddress, network.contractAddress);
  }
});

test("signed PR webhooks and backfills link every deployment without duplicate child rows", async () => {
  const payload = JSON.stringify({
    action: "opened",
    repository: { owner: { login: "example" }, name: "project" },
    pull_request: {
      html_url: prUrl,
      user: { login: "author" },
      title: "Fix #12",
      body: "Closes #12",
    },
  });
  const signature =
    "sha256=" +
    createHmac("sha256", "local-test-webhook-secret")
      .update(payload)
      .digest("hex");
  for (let replay = 0; replay < 2; replay++) {
    const response = await app.inject({
      method: "POST",
      url: "/github/webhook",
      payload,
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request",
        "x-hub-signature-256": signature,
      },
    });
    assert.equal(response.statusCode, 200, response.body);
  }
  assert.equal(await getPrisma().linkedPullRequest.count(), 3);
  const result = await backfillLinkedPullRequests({
    prisma: getPrisma(),
    github: { userToken: "test-only-token" },
  });
  assert.equal(result.ok, true);
  assert.equal("updated" in result && result.updated, 3);
  assert.equal(await getPrisma().linkedPullRequest.count(), 3);
  const rows = await getPrisma().linkedPullRequest.findMany();
  assert.equal(new Set(rows.map((row) => row.bountyDbId)).size, 3);
});

test("claim, payout and refund signatures bind the selected chain, contract, nonce and network-specific reads", async () => {
  for (const network of networks.values()) {
    for (const kind of ["Claim", "Payout", "Refund"] as const) {
      reads.length = 0;
      const body = {
        chainId: network.chainId,
        contractAddress: network.contractAddress,
        bountyId,
        claimer: A,
        claimMetadataURI: prUrl,
        token: zero,
        recipient: A,
        funder: A,
        amountWei: "10",
        deadline: "2000000000",
      };
      const response = await app.inject({
        method: "POST",
        url: `/${kind.toLowerCase()}-auth`,
        headers: { authorization: "Bearer test-only-github-token" },
        payload: body,
      });
      assert.equal(response.statusCode, 200, response.body);
      const auth = response.json();
      const fields =
        kind === "Claim"
          ? [
              { name: "claimer", type: "address" },
              { name: "claimHash", type: "bytes32" },
            ]
          : [
              { name: "token", type: "address" },
              {
                name: kind === "Payout" ? "recipient" : "funder",
                type: "address",
              },
              { name: "amount", type: "uint256" },
            ];
      const types = {
        [kind]: [
          { name: "bountyId", type: "bytes32" },
          ...fields,
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const message = {
        bountyId,
        nonce: BigInt(auth.nonce),
        deadline: BigInt(auth.deadline),
        ...(kind === "Claim"
          ? { claimer: A, claimHash: keccak256(toBytes(prUrl)) }
          : {
              token: zero,
              [kind === "Payout" ? "recipient" : "funder"]: A,
              amount: 10n,
            }),
      };
      const domain = {
        name: "GHBounties",
        version: "1",
        chainId: network.chainId,
        verifyingContract: network.contractAddress,
      };
      const data = {
        domain,
        types,
        primaryType: kind,
        message,
        signature: auth.signature,
      };
      assert.equal(await recoverTypedDataAddress(data as any), signer.address);
      assert.notEqual(
        await recoverTypedDataAddress({
          ...data,
          domain: { ...domain, chainId: 999 },
        } as any),
        signer.address,
      );
      assert.notEqual(
        await recoverTypedDataAddress({
          ...data,
          domain: { ...domain, verifyingContract: zero },
        } as any),
        signer.address,
      );
      assert.ok(reads.length >= 3);
      assert.ok(
        reads.every(
          (read) =>
            read.deployment === network.key &&
            read.address === network.contractAddress,
        ),
      );
      assert.equal(
        auth.nonce,
        String([...networks.keys()].indexOf(network.key) + 1),
      );
    }
  }
});

test("authorization fails closed for absent/partial/unknown deployment, incorrect RPC chain or authorizer", async () => {
  const payload = { bountyId, token: zero, recipient: A, amountWei: "10" };
  const request = (extra: object = {}) =>
    app.inject({
      method: "POST",
      url: "/payout-auth",
      headers: { authorization: "Bearer test-only-github-token" },
      payload: { ...payload, ...extra },
    });
  assert.equal((await request()).statusCode, 409);
  assert.equal((await request({ chainId: 1 })).statusCode, 400);
  assert.equal(
    (await request({ chainId: 99, contractAddress: A })).statusCode,
    404,
  );
  wrongChain = true;
  assert.equal((await request(configs[0])).statusCode, 503);
  wrongChain = false;
  wrongSigner = true;
  assert.equal((await request(configs[0])).statusCode, 503);
  wrongSigner = false;
});

test("an unambiguous legacy auth request infers its indexed deployment", async () => {
  const uniqueId = `0x${"04".repeat(32)}`;
  const row = await getPrisma().bounty.create({
    data: {
      bountyId: uniqueId,
      repoHash,
      issueNumber: 13,
      metadataURI: issueUrl,
      status: "OPEN",
      chainId: 11155111,
      contractAddress: A,
    },
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/payout-auth",
      headers: { authorization: "Bearer test-only-github-token" },
      payload: {
        bountyId: uniqueId,
        token: zero,
        recipient: A,
        amountWei: "10",
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().nonce, "2");
    assert.equal(
      (await app.inject(`/bounties?bountyId=${uniqueId}`)).json().bounty.id,
      row.id,
    );
  } finally {
    await getPrisma().bounty.delete({ where: { id: row.id } });
  }
});

test("indexer replays a legacy partial block, orders logs, advances only completed ranges, and keeps checkpoints separate", async () => {
  const network = networks.get(networkKey(configs[0]!))!;
  const cfg = { ...network, github: null, backfillBlockChunk: 2 };
  const seen: bigint[] = [];
  const client = {
    getChainId: async () => 1,
    getBytecode: async () => "0x1234",
    getBlockNumber: async () => 12n,
    getContractEvents: async ({ fromBlock }: any) => {
      seen.push(fromBlock);
      return fromBlock === 10n
        ? [
            {
              eventName: "StatusChanged",
              args: { bountyId, status: 2n },
              blockNumber: 10n,
              logIndex: 9,
              transactionHash: txHash,
            },
            {
              eventName: "StatusChanged",
              args: { bountyId, status: 1n },
              blockNumber: 10n,
              logIndex: 8,
              transactionHash: txHash,
            },
          ]
        : [];
    },
  };
  await getPrisma().indexerState.create({
    data: { chainId: 1, contractAddress: A, lastBlock: 10 },
  });
  const stop = await startIndexer({ ...cfg, publicClient: client as any });
  stop();
  assert.deepEqual(seen, [10n, 12n]);
  const state = await getPrisma().indexerState.findFirstOrThrow();
  assert.equal(state.lastBlock, 12);
  assert.equal(await getPrisma().indexerState.count(), 1);
  const bounty = await getPrisma().bounty.findUniqueOrThrow({
    where: {
      bountyId_chainId_contractAddress: {
        bountyId,
        chainId: 1,
        contractAddress: A,
      },
    },
  });
  assert.equal(bounty.status, "CLOSED");
  const other = await getPrisma().bounty.findFirstOrThrow({
    where: { chainId: 11155111 },
  });
  assert.equal(other.status, "IMPLEMENTED");
  client.getContractEvents = async () => {
    throw new Error("simulated RPC failure");
  };
  await assert.rejects(
    startIndexer({ ...cfg, publicClient: client as any }),
    /simulated RPC failure/,
  );
  assert.equal(
    (await getPrisma().indexerState.findFirstOrThrow()).lastBlock,
    12,
  );
});
