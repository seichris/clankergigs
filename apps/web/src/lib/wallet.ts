import { createPublicClient, createWalletClient, custom, http, type Address, type Hex } from "viem";
import { appChain } from "./chain";

export function getConfig() {
  const chain = appChain();
  const contractAddress = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "") as Hex;
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || chain.rpcUrls.default.http[0];

  if (!contractAddress || !contractAddress.startsWith("0x") || contractAddress.length !== 42) {
    throw new Error("Missing NEXT_PUBLIC_CONTRACT_ADDRESS");
  }

  return { chain, contractAddress, rpcUrl };
}

export function getPublicClient() {
  const { chain, rpcUrl } = getConfig();
  return createPublicClient({ chain, transport: http(rpcUrl) });
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

