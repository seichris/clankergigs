import { createPublicClient, createWalletClient, custom, fallback, http, type Address, type EIP1193Provider } from "viem";
import { appChain } from "./chain";
import { assertActiveNetwork, type Deployment } from "./networks";

export function getConfig(network: Deployment | null) {
  if (!network) throw new Error("Select an available network first");
  const chain = appChain(network.chainId);
  const contractAddress = network.contractAddress;
  const rpcUrl = chain.rpcUrls.default.http[0];

  if (!contractAddress || !contractAddress.startsWith("0x") || contractAddress.length !== 42) {
    throw new Error("Invalid selected contract address");
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

export async function ensureWalletChain(targetChainId: number) {
  const eth = (globalThis as typeof globalThis & { ethereum?: EIP1193Provider }).ethereum;
  if (!eth?.request) throw new Error("No injected wallet found (window.ethereum)");
  const currentHex = await eth.request({ method: "eth_chainId" }).catch(() => null);
  const current = parseChainIdHex(currentHex);
  if (current === targetChainId) return;

  const targetHex = `0x${targetChainId.toString(16)}`;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetHex }] });
  } catch (err: unknown) {
    // Common MetaMask error code when the chain isn't added yet.
    const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
    if (code === 4902) {
      throw new Error(`Wallet does not have chain ${targetChainId} configured. Add it in your wallet, then retry.`);
    }
    throw err;
  }
  const after = parseChainIdHex(await eth.request({ method: "eth_chainId" }));
  if (after !== targetChainId) throw new Error("Wallet chain mismatch after switching");
}

export function getPublicClient(network: Deployment | null) {
  const { chain, rpcUrl } = getConfig(network);
  const rpcUrls = chain.rpcUrls.default.http.filter(Boolean);
  const transport = rpcUrls.length > 1 ? fallback(rpcUrls.map((url) => http(url))) : http(rpcUrl);
  return createPublicClient({ chain, transport });
}

export function getWalletClient(network: Deployment | null) {
  assertActiveNetwork(network);
  const selected = network;
  const { chain } = getConfig(selected);
  const eth = (globalThis as typeof globalThis & { ethereum?: EIP1193Provider }).ethereum;
  if (!eth) throw new Error("No injected wallet found (window.ethereum)");
  const client = createWalletClient({ chain, transport: custom(eth) });
  const writeContract: typeof client.writeContract = async parameters => {
    assertActiveNetwork(selected);
    await ensureWalletChain(selected.chainId);
    // A selector change while a wallet prompt is open cancels this operation.
    assertActiveNetwork(selected);
    return client.writeContract(parameters);
  };
  return { ...client, writeContract };
}

export async function requestAccounts(): Promise<Address> {
  const eth = (globalThis as typeof globalThis & { ethereum?: EIP1193Provider }).ethereum;
  if (!eth) throw new Error("No injected wallet found (window.ethereum)");
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  return accounts[0] as Address;
}
