import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  activateNetwork,
  parseDeployments,
  networkQuery,
  type Deployment,
} from "../src/lib/networks";
import {
  getConfig,
  getWalletClient,
  ensureWalletChain,
} from "../src/lib/wallet";

const A: Deployment = { chainId: 1, contractAddress: `0x${"ab".repeat(20)}` };
const B: Deployment = { chainId: 11155111, contractAddress: A.contractAddress };
const C: Deployment = { chainId: 1, contractAddress: `0x${"cd".repeat(20)}` };
const account = `0x${"12".repeat(20)}` as const;
const abi = [
  {
    type: "function",
    name: "test",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;
const hash = `0x${"34".repeat(32)}`;
const calls: Array<{ method: string; params?: any[] }> = [];

function injectedWallet(
  options: { ignoreSwitch?: boolean; onSwitch?: () => void } = {},
) {
  let chainId = B.chainId;
  (globalThis as any).ethereum = {
    request: async (request: { method: string; params?: any[] }) => {
      calls.push(request);
      if (request.method === "eth_chainId") return `0x${chainId.toString(16)}`;
      if (request.method === "wallet_switchEthereumChain") {
        options.onSwitch?.();
        if (!options.ignoreSwitch)
          chainId = parseInt(request.params?.[0]?.chainId, 16);
        return null;
      }
      if (request.method === "eth_sendTransaction") return hash;
      throw new Error(`Unexpected wallet request: ${request.method}`);
    },
  };
}

afterEach(() => {
  calls.length = 0;
  activateNetwork(null);
  delete (globalThis as any).ethereum;
});

test("discovery and query strings preserve both chain and contract; no selection cannot use an env fallback", () => {
  assert.deepEqual(parseDeployments([A, B, C]), [A, B, C]);
  for (const invalid of [
    [],
    null,
    [A, A],
    [{ ...A, chainId: -1 }],
    [{ ...A, contractAddress: "0x0" }],
  ]) {
    assert.throws(() => parseDeployments(invalid));
  }
  assert.equal(
    new URLSearchParams(networkQuery(C)).get("contractAddress"),
    C.contractAddress,
  );
  assert.equal(getConfig(C).contractAddress, C.contractAddress);
  assert.equal(getConfig(B).chain.id, B.chainId);
  assert.throws(() => getConfig(null), /Select/);
});

test("writes switch and recheck the wallet chain and use the selected contract", async () => {
  injectedWallet();
  const selected = activateNetwork(C);
  const client = getWalletClient(selected);
  assert.equal(
    await client.writeContract({
      address: C.contractAddress,
      abi,
      functionName: "test",
      account,
    }),
    hash,
  );
  assert.equal(
    calls.filter((call) => call.method === "wallet_switchEthereumChain").length,
    1,
  );
  assert.ok(calls.filter((call) => call.method === "eth_chainId").length >= 2);
  assert.equal(
    calls.find((call) => call.method === "eth_sendTransaction")?.params?.[0]
      ?.to,
    C.contractAddress,
  );
});

test("ignored or rejected wallet switches cannot send a transaction", async () => {
  injectedWallet({ ignoreSwitch: true });
  const client = getWalletClient(activateNetwork(A));
  await assert.rejects(
    client.writeContract({
      address: A.contractAddress,
      abi,
      functionName: "test",
      account,
    }),
    /mismatch/,
  );
  assert.equal(
    calls.filter((call) => call.method === "eth_sendTransaction").length,
    0,
  );
  (globalThis as any).ethereum.request = async ({ method }: any) => {
    if (method === "eth_chainId") return "0xaa36a7";
    throw Object.assign(new Error("User rejected switch"), { code: 4001 });
  };
  await assert.rejects(ensureWalletChain(1), /rejected/);
});

test("A to B to A invalidates an earlier async write, including same-chain contract changes", async () => {
  injectedWallet();
  const client = getWalletClient(activateNetwork(A));
  activateNetwork(C);
  activateNetwork(A);
  await assert.rejects(
    client.writeContract({
      address: A.contractAddress,
      abi,
      functionName: "test",
      account,
    }),
    /selection changed/,
  );
  assert.equal(calls.length, 0);
});

test("changing selection while the wallet switch prompt is open cancels the pending write", async () => {
  injectedWallet({
    onSwitch: () => {
      activateNetwork(C);
    },
  });
  const client = getWalletClient(activateNetwork(A));
  await assert.rejects(
    client.writeContract({
      address: A.contractAddress,
      abi,
      functionName: "test",
      account,
    }),
    /selection changed/,
  );
  assert.equal(
    calls.filter((call) => call.method === "eth_sendTransaction").length,
    0,
  );
});
