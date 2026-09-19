import { assertActiveNetwork, type AppNetwork } from "./network";
import { createPublicClient, createWalletClient, custom, fallback, http, type Address } from "viem";
import { appChain } from "./chain";

export function getConfig(network: AppNetwork) {
  const base = appChain(network.chainId);
  const urls = network.publicRpcUrls?.length ? network.publicRpcUrls : base.rpcUrls.default.http;
  const chain = { ...base, name: network.name || base.name, rpcUrls: { default: { http: urls } } };
  const contractAddress = network.contractAddress;
  const rpcUrl = chain.rpcUrls.default.http[0];

  if (!contractAddress || !contractAddress.startsWith("0x") || contractAddress.length !== 42) {
    throw new Error("Missing selected contract address");
  }

  if (!rpcUrl) {
    throw new Error("Missing RPC URL (set NEXT_PUBLIC_RPC_URL, or NEXT_PUBLIC_RPC_URLS_ETHEREUM_SEPOLIA/MAINNET)");
  }

  if (!/^https?:\/\//i.test(rpcUrl)) {
    throw new Error(
      "Invalid RPC URL (must start with http:// or https://). Check for accidental quotes in env vars like NEXT_PUBLIC_RPC_URLS_ETHEREUM_MAINNET."
    );
  }

  return { chain, contractAddress, rpcUrl };
}

function parseChainIdHex(chainIdHex: unknown): number | null {
  if (typeof chainIdHex !== "string") return null;
  if (!chainIdHex.startsWith("0x")) return null;
  const n = Number.parseInt(chainIdHex, 16);
  return Number.isFinite(n) ? n : null;
}

export async function ensureWalletChain(targetChainId: number, network?: AppNetwork) {
  if (network) assertActiveNetwork(network);
  const eth = (globalThis as any).ethereum;
  if (!eth?.request) throw new Error("No injected wallet found (window.ethereum)");
  const currentHex = await eth.request({ method: "eth_chainId" }).catch(() => null);
  const current = parseChainIdHex(currentHex);
  if (network) assertActiveNetwork(network);
  if (current === targetChainId) return;

  const targetHex = `0x${targetChainId.toString(16)}`;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetHex }] });
    if (network) assertActiveNetwork(network);
    const switched = parseChainIdHex(await eth.request({ method: "eth_chainId" }));
    if (network) assertActiveNetwork(network);
    if (switched !== targetChainId) throw new Error("Wallet did not switch to the selected chain.");
  } catch (err: any) {
    // Common MetaMask error code when the chain isn't added yet.
    const code = err?.code;
    if (code === 4902) {
      throw new Error(`Wallet does not have chain ${targetChainId} configured. Add it in your wallet, then retry.`);
    }
    throw err;
  }
}

export function getPublicClient(network: AppNetwork) {
  const { chain, rpcUrl } = getConfig(network);
  const rpcUrls = chain.rpcUrls.default.http.filter(Boolean);
  const transport = rpcUrls.length > 1 ? fallback(rpcUrls.map((url) => http(url))) : http(rpcUrl);
  return createPublicClient({ chain, transport });
}

export function getWalletClient(network: AppNetwork) {
  assertActiveNetwork(network);
  const { chain } = getConfig(network);
  const eth = (globalThis as any).ethereum;
  if (!eth) throw new Error("No injected wallet found (window.ethereum)");
  const guardedProvider = {
    request: async (args: { method: string; params?: unknown }) => {
      if (args.method === "eth_sendTransaction" || args.method === "eth_sendRawTransaction") {
        assertActiveNetwork(network);
        const current = parseChainIdHex(await eth.request({ method: "eth_chainId" }));
        assertActiveNetwork(network);
        if (current !== network.chainId) throw new Error("Wallet chain does not match the selected network.");
      }
      return eth.request(args);
    }
  };
  return createWalletClient({ chain, transport: custom(guardedProvider, { retryCount: 0 }) });
}

export async function requestAccounts(): Promise<Address> {
  const eth = (globalThis as any).ethereum;
  if (!eth) throw new Error("No injected wallet found (window.ethereum)");
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  return accounts[0] as Address;
}
