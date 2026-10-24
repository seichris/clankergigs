"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  chooseNetwork,
  clearNetwork,
  networkKey,
  networkQuery,
  selectNetwork,
  type AppNetwork,
} from "@/lib/network";

const NetworkContext = React.createContext<{
  network: AppNetwork;
  networks: AppNetwork[];
  changeNetwork: (network: AppNetwork) => void;
} | null>(null);
const storageKey = "ghb-network";

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [networks, setNetworks] = React.useState<AppNetwork[] | null>(null);
  const [network, setNetwork] = React.useState<AppNetwork | null>(null);
  const currentNetwork = React.useRef<AppNetwork | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const pathname = usePathname();
  const search = useSearchParams().toString();

  React.useEffect(() => {
    const controller = new AbortController();
    const api = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787";
    void fetch(`${api}/networks`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load networks (${res.status})`);
        const data = await res.json();
        if (
          !Array.isArray(data.networks) ||
          data.networks.some(
            (n: AppNetwork) =>
              !Number.isSafeInteger(n.chainId) ||
              !/^0x[\da-fA-F]{40}$/.test(n.contractAddress),
          )
        ) {
          throw new Error("Invalid network registry");
        }
        setNetworks(data.networks);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(String(err.message));
      });
    return () => controller.abort();
  }, []);

  React.useEffect(() => {
    if (!networks) return;
    try {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(storageKey);
      } catch {
        /* Private browsing. */
      }
      const next = chooseNetwork(networks, search, stored);
      if (!next) throw new Error("No bounty networks are configured.");
      if (
        !currentNetwork.current ||
        networkKey(currentNetwork.current) !== networkKey(next)
      ) {
        currentNetwork.current = selectNetwork(next);
        setNetwork(currentNetwork.current);
      }
      try {
        localStorage.setItem(storageKey, networkKey(next));
      } catch {
        /* Optional persistence. */
      }
      setError(null);
    } catch (err) {
      clearNetwork();
      currentNetwork.current = null;
      setError((err as Error).message);
    }
  }, [networks, pathname, search]);

  const changeNetwork = React.useCallback((next: AppNetwork) => {
    currentNetwork.current = selectNetwork(next);
    setNetwork(currentNetwork.current);
    try {
      localStorage.setItem(storageKey, networkKey(next));
    } catch {
      /* Optional persistence. */
    }
    const url = new URL(window.location.href);
    new URLSearchParams(networkQuery(next)).forEach((value, key) =>
      url.searchParams.set(key, value),
    );
    window.history.replaceState(null, "", url);
  }, []);

  if (error)
    return (
      <div className="p-6" role="alert">
        {error} <a href="/">Bounty list</a>
      </div>
    );
  if (!network || !networks)
    return (
      <div className="p-6" role="status">
        Loading networks…
      </div>
    );
  return (
    <NetworkContext.Provider value={{ network, networks, changeNetwork }}>
      <React.Fragment key={networkKey(network)}>{children}</React.Fragment>
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  const context = React.useContext(NetworkContext);
  if (!context) throw new Error("NetworkProvider is required");
  return context;
}

export function NetworkSelector() {
  const { network, networks, changeNetwork } = useNetwork();
  return (
    <select
      aria-label="Bounty network"
      className="rounded-md border bg-background px-3 py-2 text-sm"
      value={networkKey(network)}
      onChange={(event) => {
        const next = networks.find((n) => networkKey(n) === event.target.value);
        if (next) changeNetwork(next);
      }}
    >
      {networks.map((n) => (
        <option key={networkKey(n)} value={networkKey(n)}>
          {n.name ||
            (n.chainId === 1
              ? "Ethereum"
              : n.chainId === 11155111
                ? "Sepolia"
                : `Chain ${n.chainId}`)}
          {networks.filter((other) => other.chainId === n.chainId).length > 1
            ? ` (${n.contractAddress.slice(0, 8)}…${n.contractAddress.slice(-4)})`
            : ""}
        </option>
      ))}
    </select>
  );
}
