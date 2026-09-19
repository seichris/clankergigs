import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { keccak256, toBytes, verifyTypedData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createNetworkRegistry,
  publicNetworks,
  resolveNetwork,
} from "../src/networks.js";
import { loadEnv } from "../src/env.js";
import { buildApplication } from "../src/index.js";
import { getPrisma } from "../src/db.js";
import { handleLog, startIndexer } from "../src/indexer/indexer.js";
import { backfillLinkedPullRequests } from "../src/github/backfill.js";

const contract = `0x${"ab".repeat(20)}` as Hex;
const secondContract = `0x${"cd".repeat(20)}` as Hex;
const bountyId = `0x${"11".repeat(32)}` as Hex;
const repoHash = `0x${"22".repeat(32)}` as Hex;
const zero = `0x${"00".repeat(20)}` as Hex;
const actor = `0x${"33".repeat(20)}` as Hex;
const issueUrl = "https://github.com/example/project/issues/12";
const prUrl = "https://github.com/example/project/pull/13";
const registryInput = [
  {
    chainId: 1,
    contractAddress: contract,
    rpcUrls: ["https://rpc.invalid/private-api-key"],
  },
  {
    chainId: 11155111,
    contractAddress: contract,
    rpcUrls: ["http://127.0.0.1:18545"],
  },
  {
    chainId: 1,
    contractAddress: secondContract,
    rpcUrls: ["http://127.0.0.1:18546"],
  },
];
const envInput = {
  CHAIN_ID: 31337,
  CONTRACT_ADDRESS: "",
  RPC_URLS: [],
  INDEXER_START_BLOCK: undefined,
};
const networks = createNetworkRegistry({
  ...envInput,
  NETWORKS_JSON: JSON.stringify(registryInput),
});
const dir = mkdtempSync(join(tmpdir(), "ghb-networks-"));
const migrationRoot = new URL("../prisma/migrations/", import.meta.url);
const migrations = readdirSync(migrationRoot)
  .filter((name) => /^\d/.test(name))
  .sort();
const finalMigration = migrations.at(-1)!;
const migrationSql = (name: string) =>
  readFileSync(new URL(`${name}/migration.sql`, migrationRoot), "utf8");

function legacyDatabase(path = ":memory:") {
  const db = new DatabaseSync(path);
  for (const name of migrations.slice(0, -1)) db.exec(migrationSql(name));
  return db;
}

function seedLegacy(db: DatabaseSync) {
  db.prepare(
    "INSERT INTO Repo (id, repoHash, maintainerAddress, updatedAt) VALUES (?, ?, ?, ?)",
  ).run("repo-original", repoHash, actor, "2026-02-12T00:00:00.000Z");
  db.prepare(
    "INSERT INTO Bounty (id,bountyId,repoHash,issueNumber,metadataURI,status,chainId,contractAddress,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(
    "bounty-original",
    bountyId,
    repoHash,
    12,
    issueUrl,
    "OPEN",
    1,
    contract.toUpperCase().replace("0X", "0x"),
    "2026-02-12T00:00:00.000Z",
  );
  for (const table of [
    "BountyAsset",
    "Funding",
    "Claim",
    "Payout",
    "Refund",
    "LinkedPullRequest",
  ]) {
    const columns = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
      name: string;
      type: string;
    }>;
    const values = columns.map(({ name, type }) => {
      if (name === "id") return `${table}-original`;
      if (name === "bountyId") return bountyId;
      if (name === "prUrl" || name === "metadataURI") return prUrl;
      if (name === "token") return zero;
      if (name === "txHash") return `0x${"44".repeat(32)}`;
      if (type === "INTEGER") return 1;
      if (type === "DATETIME") return "2026-02-12T00:00:00.000Z";
      if (["amountWei", "escrowed", "funded", "paid"].includes(name))
        return "100";
      return actor;
    });
    db.prepare(
      `INSERT INTO "${table}" (${columns.map((c) => `"${c.name}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
    ).run(...values);
  }
}

before(() => {
  process.env.DATABASE_URL = `file:${join(dir, "test.db")}`;
  process.env.GITHUB_WEBHOOK_SECRET = "local-fixture-only";
  const db = legacyDatabase(join(dir, "test.db"));
  for (const name of [finalMigration]) db.exec(migrationSql(name));
  db.close();
});

after(async () => {
  await getPrisma().$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

test("registry normalizes pairs, preserves fallback, rejects duplicates, and keeps server RPCs private", () => {
  assert.equal(
    resolveNetwork(networks, {
      chainId: "1",
      contractAddress: contract.toUpperCase().replace("0X", "0x"),
    }).contractAddress,
    contract,
  );
  assert.throws(() => resolveNetwork(networks, {}), /Ambiguous/);
  assert.throws(() => resolveNetwork(networks, { chainId: 1 }), /both/);
  assert.throws(
    () => resolveNetwork(networks, { chainId: 5, contractAddress: contract }),
    /not configured/,
  );
  assert.throws(
    () => createNetworkRegistry({ ...envInput, NETWORKS_JSON: "invalid" }),
    /JSON/,
  );
  assert.throws(
    () =>
      createNetworkRegistry({
        ...envInput,
        NETWORKS_JSON: JSON.stringify([
          registryInput[0],
          {
            ...registryInput[0],
            contractAddress: contract.toUpperCase().replace("0X", "0x"),
          },
        ]),
      }),
    /Duplicate/,
  );
  const fallback = createNetworkRegistry({
    ...envInput,
    CONTRACT_ADDRESS: contract,
    RPC_URLS: ["http://127.0.0.1:8545"],
  });
  assert.equal(resolveNetwork(fallback, {}).chainId, 31337);
  assert.deepEqual(createNetworkRegistry(envInput), []);
  assert.equal(
    JSON.stringify(publicNetworks(networks)).includes("private-api-key"),
    false,
  );
});

test("migration preserves primary keys, amounts, timestamps and every child relation", () => {
  const db = legacyDatabase();
  seedLegacy(db);
  const tables = [
    "Repo",
    "Bounty",
    "BountyAsset",
    "Funding",
    "Claim",
    "Payout",
    "Refund",
    "LinkedPullRequest",
  ];
  const original = new Map(
    tables.map((table) => [
      table,
      db.prepare(`SELECT * FROM "${table}"`).get()!,
    ]),
  );
  db.exec(migrationSql(finalMigration));
  for (const table of tables) {
    const row = db.prepare(`SELECT * FROM "${table}"`).get()!;
    const { bountyDbId, ...rest } = row;
    const expected = { ...original.get(table) };
    if (table === "Bounty") expected.contractAddress = contract;
    assert.deepEqual({ ...rest }, expected, table);
    if (!["Repo", "Bounty"].includes(table))
      assert.equal(bountyDbId, "bounty-original");
  }
  assert.equal(
    db.prepare("SELECT maintainerAddress FROM RepoDeployment").get()!
      .maintainerAddress,
    actor,
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("migration refuses an orphan child instead of silently dropping it", () => {
  const db = legacyDatabase();
  seedLegacy(db);
  db.exec("PRAGMA foreign_keys=OFF; UPDATE Funding SET bountyId='missing';");
  assert.throws(() => db.exec(migrationSql(finalMigration)), /NOT NULL/);
  db.exec("ROLLBACK;");
  assert.equal(
    db.prepare("SELECT id FROM Funding").get()!.id,
    "Funding-original",
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM BountyAsset").get()!.n, 1);
  db.close();
});

test("indexing identical bounty IDs, claim IDs and event IDs keeps all three deployments isolated and replay-safe", async () => {
  const prisma = getPrisma();
  const client = {} as any;
  const event = (eventName: string, logIndex: number, args: object) => ({
    eventName,
    args,
    blockNumber: 10n,
    transactionHash: `0x${"55".repeat(32)}`,
    logIndex,
  });
  for (let i = 0; i < networks.length; i++) {
    const cfg = networks[i]!;
    await handleLog(
      client,
      cfg,
      event("RepoRegistered", 0, {
        repoHash,
        maintainer: i === 1 ? zero : actor,
      }),
    );
    const created = event("BountyCreated", 1, {
      bountyId,
      repoHash,
      issueNumber: 12n,
      metadataURI: issueUrl,
    });
    await handleLog(client, cfg, created);
    const events = [
      event("BountyFunded", 2, {
        bountyId,
        token: zero,
        funder: actor,
        amount: 100n + BigInt(i),
        lockedUntil: 0n,
      }),
      event("ClaimSubmitted", 3, {
        bountyId,
        claimId: 1n,
        claimer: actor,
        metadataURI: prUrl,
      }),
      event("PaidOut", 4, {
        bountyId,
        token: zero,
        recipient: actor,
        amount: 20n,
      }),
      event("Refunded", 5, {
        bountyId,
        token: zero,
        funder: actor,
        amount: 5n,
      }),
      event("StatusChanged", 6, { bountyId, status: 1n }),
    ];
    for (const log of [...events, ...events, created])
      await handleLog(client, cfg, log);
  }
  const rows = await prisma.bounty.findMany({
    include: {
      assets: true,
      claims: true,
      fundings: true,
      payouts: true,
      refunds: true,
    },
  });
  assert.equal(rows.length, 3);
  for (const row of rows) {
    const i = networks.findIndex(
      (n) =>
        n.chainId === row.chainId && n.contractAddress === row.contractAddress,
    );
    assert.equal(row.assets[0]!.funded, String(100 + i));
    assert.equal(row.assets[0]!.escrowed, String(75 + i));
    assert.equal(row.assets[0]!.paid, "20");
    assert.equal(row.status, "IMPLEMENTED");
    for (const children of [
      row.assets,
      row.claims,
      row.fundings,
      row.payouts,
      row.refunds,
    ]) {
      assert.equal(children.length, 1);
      assert.equal(children[0]!.bountyDbId, row.id);
    }
  }
  const repos = await prisma.repoDeployment.findMany();
  assert.equal(repos.length, 3);
  assert.equal(
    repos.find((r) => r.chainId === 11155111)!.maintainerAddress,
    zero,
  );
});

test("read API returns all configured networks, filters explicit pairs and rejects ambiguous bounty IDs", async () => {
  const { app } = await buildApplication(loadEnv(), networks);
  try {
    const list = await app.inject("/issues");
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().issues.length, 3);
    assert.equal(
      (await app.inject(`/bounties?bountyId=${bountyId}`)).statusCode,
      409,
    );
    assert.equal(
      (await app.inject(`/bounties?bountyId=${bountyId}&chainId=1`)).statusCode,
      409,
    );
    for (const n of networks) {
      const query = `chainId=${n.chainId}&contractAddress=${n.contractAddress}`;
      const res = await app.inject(`/bounties?bountyId=${bountyId}&${query}`);
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().bounty.chainId, n.chainId);
      assert.equal(res.json().bounty.contractAddress, n.contractAddress);
      assert.equal(
        (await app.inject(`/issues?${query}`)).json().issues.length,
        1,
      );
    }
    for (const path of [
      "/issues?chainId=bad",
      "/bounties?contractAddress=bad",
      "/issues?chainId=42",
    ]) {
      assert.equal((await app.inject(path)).statusCode, 400);
    }
    const discovery = await app.inject("/networks");
    assert.equal(discovery.json().networks.length, 3);
    assert.equal(discovery.body.includes("private-api-key"), false);
  } finally {
    await app.close();
  }
});

test("authenticated webhook links one PR to every deployment and remains idempotent", async () => {
  const { app } = await buildApplication(loadEnv(), networks);
  try {
    const payload = JSON.stringify({
      action: "opened",
      repository: { owner: { login: "example" }, name: "project" },
      pull_request: {
        html_url: prUrl,
        title: "Fixes #12",
        user: { login: "contributor" },
      },
    });
    const headers = {
      "content-type": "application/json",
      "x-github-event": "pull_request",
      "x-hub-signature-256": `sha256=${createHmac("sha256", "local-fixture-only").update(payload).digest("hex")}`,
    };
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/github/webhook",
            headers,
            payload,
          })
        ).statusCode,
        200,
      );
    assert.equal(await getPrisma().linkedPullRequest.count(), 3);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/github/webhook",
          payload,
          headers: { ...headers, "x-hub-signature-256": "sha256=invalid" },
        })
      ).statusCode,
      401,
    );
  } finally {
    await app.close();
  }
});

test("PR backfill covers all deployments instead of the legacy env chain", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("https://api.github.com/search/issues?"))
      return Response.json({
        items: [{ html_url: prUrl, user: { login: "contributor" } }],
      });
    if (url.endsWith("/issues/13/comments?per_page=100"))
      return Response.json([{ body: "<!-- ghb-pr-claim-reminder -->" }]);
    // Comment helper may read/post a reminder; only local mock responses are used.
    if (url.startsWith("https://api.github.com/")) return Response.json([]);
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  try {
    const result = await backfillLinkedPullRequests({
      prisma: getPrisma(),
      networks,
      github: { userToken: "test-only" },
    });
    assert.equal(result.scanned, 3);
    assert.equal(await getPrisma().linkedPullRequest.count(), 3);
  } finally {
    globalThis.fetch = original;
  }
});

test("claim, payout and refund signatures use the selected RPC, nonce and EIP-712 domain", async () => {
  const originalFetch = globalThis.fetch;
  const testKey = `0x${"0".repeat(63)}1` as Hex; // Public local test key; never funded or broadcast.
  const signer = privateKeyToAccount(testKey);
  const env = { ...loadEnv(), BACKEND_SIGNER_PRIVATE_KEY: testKey };
  const configured = createNetworkRegistry({
    ...envInput,
    NETWORKS_JSON: JSON.stringify(registryInput),
  });
  for (let i = 0; i < configured.length; i++) {
    const network = configured[i]!;
    network.publicClient = {
      getChainId: async () => network.chainId,
      readContract: async ({ address, functionName }: any) => {
        assert.equal(address, network.contractAddress);
        if (functionName === "bounties")
          return [repoHash, 12n, 0, 1n, issueUrl];
        if (functionName === "escrowed") return 100n;
        return BigInt(i + 10);
      },
    } as any;
  }
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://api.github.com/user")
      return Response.json({ login: "contributor", id: 1 });
    if (url.endsWith("/pulls/13"))
      return Response.json({ user: { login: "contributor" } });
    if (url === "https://api.github.com/repos/example/project")
      return Response.json({ permissions: { admin: true } });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  const { app } = await buildApplication(env, configured);
  try {
    const headers = {
      authorization: "Bearer fixture-only",
      "content-type": "application/json",
    };
    const cases = [
      {
        route: "claim",
        type: "Claim",
        fields: [
          { name: "claimer", type: "address" },
          { name: "claimHash", type: "bytes32" },
        ],
        payload: { claimer: actor, claimMetadataURI: prUrl },
        message: { claimer: actor, claimHash: keccak256(toBytes(prUrl)) },
      },
      {
        route: "payout",
        type: "Payout",
        fields: [
          { name: "token", type: "address" },
          { name: "recipient", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        payload: { token: zero, recipient: actor, amountWei: "1" },
        message: { token: zero, recipient: actor, amount: 1n },
      },
      {
        route: "refund",
        type: "Refund",
        fields: [
          { name: "token", type: "address" },
          { name: "funder", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        payload: { token: zero, funder: actor, amountWei: "1" },
        message: { token: zero, funder: actor, amount: 1n },
      },
    ];
    for (const c of cases) {
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/${c.route}-auth`,
            headers,
            payload: { bountyId, ...c.payload },
          })
        ).statusCode,
        409,
      );
      for (let i = 0; i < configured.length; i++) {
        const n = configured[i]!;
        const res = await app.inject({
          method: "POST",
          url: `/${c.route}-auth`,
          headers,
          payload: {
            bountyId,
            ...c.payload,
            chainId: n.chainId,
            contractAddress: n.contractAddress,
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = res.json();
        assert.equal(body.nonce, String(i + 10));
        const typed = {
          address: signer.address,
          signature: body.signature,
          domain: {
            name: "GHBounties",
            version: "1",
            chainId: n.chainId,
            verifyingContract: n.contractAddress,
          },
          types: {
            [c.type]: [
              { name: "bountyId", type: "bytes32" },
              ...c.fields,
              { name: "nonce", type: "uint256" },
              { name: "deadline", type: "uint256" },
            ],
          },
          primaryType: c.type,
          message: {
            bountyId,
            ...c.message,
            nonce: BigInt(body.nonce),
            deadline: BigInt(body.deadline),
          },
        };
        assert.equal(await verifyTypedData(typed as any), true);
        assert.equal(
          await verifyTypedData({
            ...typed,
            domain: { ...typed.domain, chainId: 42 },
          } as any),
          false,
        );
      }
    }
    configured[0]!.publicClient.getChainId = async () => 42;
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/payout-auth",
          headers,
          payload: {
            bountyId,
            ...cases[1]!.payload,
            chainId: 1,
            contractAddress: contract,
          },
        })
      ).statusCode,
      503,
    );
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
  }
});

test("indexer catches up complete blocks after late watcher notifications without double-counting", async () => {
  let head = 10n;
  let wake: () => Promise<void>;
  let stopped = false;
  const logs = [
    {
      eventName: "BountyCreated",
      blockNumber: 10n,
      args: { bountyId, repoHash, issueNumber: 12n, metadataURI: issueUrl },
    },
    {
      eventName: "BountyFunded",
      blockNumber: 11n,
      args: {
        bountyId,
        token: zero,
        funder: actor,
        amount: 50n,
        lockedUntil: 0n,
      },
    },
    {
      eventName: "PaidOut",
      blockNumber: 12n,
      args: { bountyId, token: zero, recipient: actor, amount: 10n },
    },
  ].map((log, logIndex) => ({
    ...log,
    logIndex,
    transactionHash: `0x${"66".repeat(32)}`,
  }));
  const cfg = {
    chainId: 31337,
    contractAddress: contract,
    rpcUrls: ["http://127.0.0.1:18547"],
    startBlock: 10,
    publicClient: {
      getChainId: async () => 31337,
      getBytecode: async () => "0x01",
      getBlockNumber: async () => head,
      getContractEvents: async ({ fromBlock, toBlock }: any) =>
        logs.filter(
          (l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock,
        ),
      watchContractEvent: ({ onLogs }: any) => {
        wake = onLogs;
        return () => {
          stopped = true;
        };
      },
    } as any,
  };
  const stop = await startIndexer(cfg);
  try {
    head = 12n;
    await wake!();
    await wake!(); // A delayed/replayed watcher notification must not replay old state.
    const bounty = await getPrisma().bounty.findFirstOrThrow({
      where: { chainId: 31337 },
      include: { assets: true },
    });
    assert.equal(bounty.assets[0]!.escrowed, "40");
    assert.equal(bounty.assets[0]!.funded, "50");
    const state = await getPrisma().indexerState.findUniqueOrThrow({
      where: {
        chainId_contractAddress: { chainId: 31337, contractAddress: contract },
      },
    });
    assert.equal(state.lastBlock, 12);
  } finally {
    stop();
  }
  assert.equal(stopped, true);
});
