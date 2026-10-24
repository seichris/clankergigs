import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  chooseNetwork,
  networkKey,
  networkParams,
  networkQuery,
  selectNetwork,
  type AppNetwork,
} from "../src/lib/network";
import {
  ensureWalletChain,
  getConfig,
  getWalletClient,
} from "../src/lib/wallet";

const a: AppNetwork = {
  chainId: 1,
  contractAddress: `0x${"ab".repeat(20)}`,
  publicRpcUrls: ["http://127.0.0.1:18545"],
};
const b: AppNetwork = {
  chainId: 11155111,
  contractAddress: a.contractAddress,
  publicRpcUrls: ["http://127.0.0.1:18546"],
};
const c: AppNetwork = { ...a, contractAddress: `0x${"cd".repeat(20)}` };
const originalProvider = (globalThis as any).ethereum;
afterEach(() => {
  (globalThis as any).ethereum = originalProvider;
});

test("deep links override saved selection and distinguish deployments on the same chain", () => {
  assert.equal(chooseNetwork([a, b, c], networkQuery(c), networkKey(b)), c);
  assert.equal(chooseNetwork([a, b, c], "", networkKey(b)), b);
  assert.equal(chooseNetwork([a, b, c], "", "removed-network"), a);
  assert.throws(
    () => chooseNetwork([a, b, c], "?chainId=1", networkKey(b)),
    /unavailable/,
  );
  assert.throws(
    () =>
      chooseNetwork(
        [a, b, c],
        `?chainId=42&contractAddress=${a.contractAddress}`,
      ),
    /unavailable/,
  );
  assert.deepEqual(networkParams(c), {
    chainId: 1,
    contractAddress: c.contractAddress,
  });
  for (const n of [a, b, c]) {
    const cfg = getConfig(n);
    assert.equal(cfg.chain.id, n.chainId);
    assert.equal(cfg.contractAddress, n.contractAddress);
    assert.equal(cfg.rpcUrl, n.publicRpcUrls![0]);
  }
});

test("wallet switching verifies the actual chain after the wallet prompt", async () => {
  let chain = "0x1";
  const calls: string[] = [];
  (globalThis as any).ethereum = {
    request: async ({ method, params }: any) => {
      calls.push(method);
      if (method === "eth_chainId") return chain;
      if (method === "wallet_switchEthereumChain") chain = params[0].chainId;
    },
  };
  await ensureWalletChain(b.chainId);
  assert.deepEqual(calls, [
    "eth_chainId",
    "wallet_switchEthereumChain",
    "eth_chainId",
  ]);
  chain = "0x1";
  (globalThis as any).ethereum = {
    request: async ({ method }: any) =>
      method === "eth_chainId" ? chain : undefined,
  };
  await assert.rejects(ensureWalletChain(b.chainId), /did not switch/);
});

test("wallet refuses stale selection and wrong-chain sends before forwarding a transaction", async () => {
  let chain = "0x1";
  let sent = 0;
  (globalThis as any).ethereum = {
    request: async ({ method }: any) => {
      if (method === "eth_chainId") return chain;
      if (method === "eth_sendTransaction") {
        sent++;
        return `0x${"11".repeat(32)}`;
      }
      throw new Error(`Unexpected wallet method: ${method}`);
    },
  };
  const selectedA = selectNetwork(a);
  const wallet = getWalletClient(selectedA);
  const send = () =>
    wallet.request({
      method: "eth_sendTransaction",
      params: [
        { from: a.contractAddress, to: a.contractAddress, value: "0x0" },
      ],
    });
  selectNetwork(c);
  await assert.rejects(send(), /selection changed/);
  selectNetwork(a);
  await assert.rejects(send(), /selection changed/); // Switching back must not revive an old operation.
  const selectedB = selectNetwork(b);
  const walletB = getWalletClient(selectedB);
  const sendB = () =>
    walletB.request({
      method: "eth_sendTransaction",
      params: [
        { from: a.contractAddress, to: a.contractAddress, value: "0x0" },
      ],
    });
  await assert.rejects(sendB(), /does not match/);
  assert.equal(sent, 0);
  chain = `0x${b.chainId.toString(16)}`;
  await sendB();
  assert.equal(sent, 1); // Mock provider only; no network or wallet is contacted.
});

test("changing deployment while the wallet switch prompt is open invalidates the operation", async () => {
  const selected = selectNetwork(b);
  (globalThis as any).ethereum = { request: async ({ method }: any) => {
    if (method === "eth_chainId") return "0x1";
    if (method === "wallet_switchEthereumChain") selectNetwork(c);
  } };
  await assert.rejects(ensureWalletChain(b.chainId, selected), /selection changed/);
});
