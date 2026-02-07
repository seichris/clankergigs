"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SuiClientProvider, WalletProvider } from "@mysten/dapp-kit";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";

function getNetwork() {
  const raw = (process.env.NEXT_PUBLIC_SUI_NETWORK || "testnet").toLowerCase().trim();
  if (raw === "mainnet" || raw === "testnet" || raw === "devnet") return raw;
  return "testnet";
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(() => new QueryClient());
  const network = getNetwork();

  const networks = React.useMemo(() => {
    const base = {
      mainnet: { url: getJsonRpcFullnodeUrl("mainnet"), network: "mainnet" as const },
      testnet: { url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" as const },
      devnet: { url: getJsonRpcFullnodeUrl("devnet"), network: "devnet" as const },
      localnet: { url: getJsonRpcFullnodeUrl("localnet"), network: "localnet" as const },
    };

    const rpcUrl = (process.env.NEXT_PUBLIC_SUI_RPC_URL || "").trim();
    if (rpcUrl) {
      return { ...base, [network]: { ...base[network], url: rpcUrl } };
    }

    return base;
  }, [network]);

  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider defaultNetwork={network} networks={networks}>
        <WalletProvider autoConnect>{children}</WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
