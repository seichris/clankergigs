import { createPublicClient, createWalletClient, custom, fallback, http, type Address, type Hex } from "viem";
import { appChain } from "./chain";

export function getConfig() {
  const chain = appChain();
  const contractAddress = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "") as Hex;
  const rpcUrl = chain.rpcUrls.default.http[0];

  if (!contractAddress || !contractAddress.startsWith("0x") || contractAddress.length !== 42) {
    throw new Error("Missing NEXT_PUBLIC_CONTRACT_ADDRESS");
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

export function getPublicClient() {
  const { chain, rpcUrl } = getConfig();
  const rpcUrls = chain.rpcUrls.default.http.filter(Boolean);
  const transport = rpcUrls.length > 1 ? fallback(rpcUrls.map((url) => http(url))) : http(rpcUrl);
  return createPublicClient({ chain, transport });
}

export function getWalletClient() {
  const { chain } = getConfig();
  const eth = (globalThis as any).ethereum;
  if (!eth) throw new Error("No injected wallet found (window.ethereum)");
  return createWalletClient({ chain, transport: custom(eth) });
}

export async function requestAccounts(): Promise<Address> {
  const eth = (globalThis as any).ethereum;
  if (!eth) throw new Error("No injected wallet found (window.ethereum)");
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  return accounts[0] as Address;
}
