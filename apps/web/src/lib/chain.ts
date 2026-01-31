import { defineChain } from "viem";

export function appChain() {
  const id = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "31337");
  if (id === 31337) {
    return defineChain({
      id: 31337,
      name: "Anvil",
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: {
        default: { http: [process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545"] }
      }
    });
  }

  if (id === 11155111) {
    return defineChain({
      id: 11155111,
      name: "Sepolia",
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_RPC_URL || ""] } }
    });
  }

  if (id === 1) {
    return defineChain({
      id: 1,
      name: "Ethereum",
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_RPC_URL || ""] } }
    });
  }

  // Fallback: user must add their chain to wallet; this is for viem typing.
  return defineChain({
    id,
    name: `Chain ${id}`,
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_RPC_URL || ""] } }
  });
}
