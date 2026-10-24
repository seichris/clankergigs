"use client";

import * as React from "react";
import {
  activateNetwork,
  deploymentKey,
  parseDeployments,
  type Deployment,
} from "@/lib/networks";

const storageKey = "clankergigs-deployment";
type NetworkContextValue = {
  network: Deployment | null;
  networks: Deployment[];
  error: string | null;
  select: (key: string) => void;
};
const NetworkContext = React.createContext<NetworkContextValue | null>(null);

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [network, setNetwork] = React.useState<Deployment | null>(null);
  const [networks, setNetworks] = React.useState<Deployment[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const choose = React.useCallback((selected: Deployment) => {
    // Invalidate pending writes synchronously, before React renders the new UI.
    setNetwork(activateNetwork(selected));
    setError(null);
    const key = deploymentKey(selected);
    try {
      localStorage.setItem(storageKey, key);
    } catch {
      /* storage may be disabled */
    }
    const url = new URL(window.location.href);
    url.searchParams.set("chainId", String(selected.chainId));
    url.searchParams.set("contractAddress", selected.contractAddress);
    window.history.replaceState(null, "", url);
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787";
    void (async () => {
      try {
        const response = await fetch(`${apiUrl}/networks`, {
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(`Network discovery failed (${response.status})`);
        const data = await response.json();
        const available = parseDeployments(data.networks);
        if (controller.signal.aborted) return;
        setNetworks(available);
        const query = new URLSearchParams(window.location.search);
        let preferred: string | null = null;
        if (query.has("chainId") || query.has("contractAddress")) {
          preferred = `${query.get("chainId")}:${query.get("contractAddress")?.toLowerCase()}`;
        } else {
          try {
            preferred = localStorage.getItem(storageKey);
          } catch {
            /* optional */
          }
        }
        const selected = preferred
          ? available.find((item) => deploymentKey(item) === preferred)
          : available[0];
        if (!selected)
          throw new Error(
            "Saved or linked deployment is unavailable. Select a network.",
          );
        choose(selected);
      } catch (err) {
        if (controller.signal.aborted) return;
        setNetwork(activateNetwork(null));
        setError(
          err instanceof Error ? err.message : "Network discovery failed",
        );
      }
    })();
    return () => {
      controller.abort();
      activateNetwork(null);
    };
  }, [choose]);

  React.useEffect(() => {
    const restore = () => {
      const query = new URLSearchParams(window.location.search);
      if (!query.has("chainId") && !query.has("contractAddress")) return;
      const key = `${query.get("chainId")}:${query.get("contractAddress")?.toLowerCase()}`;
      if (network && deploymentKey(network) === key) return;
      const selected = networks.find((item) => deploymentKey(item) === key);
      if (selected) choose(selected);
      else {
        setNetwork(activateNetwork(null));
        setError("Linked deployment is unavailable. Select a network.");
      }
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [choose, network, networks]);

  const select = React.useCallback(
    (key: string) => {
      const selected = networks.find((item) => deploymentKey(item) === key);
      if (selected) choose(selected);
    },
    [choose, networks],
  );

  return (
    <NetworkContext.Provider value={{ network, networks, error, select }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  const value = React.useContext(NetworkContext);
  if (!value) throw new Error("NetworkProvider is required");
  return value;
}

export function NetworkSelector() {
  const { network, networks, error, select } = useNetwork();
  return (
    <div className="flex flex-col gap-1">
      <label className="sr-only" htmlFor="deployment-selector">
        Network and contract
      </label>
      <select
        id="deployment-selector"
        className="rounded-md border bg-background px-3 py-2 text-sm"
        value={network ? deploymentKey(network) : ""}
        onChange={(event) => select(event.target.value)}
        disabled={!networks.length}
      >
        {!network && (
          <option value="">
            {error ? "Select a network" : "Loading networks…"}
          </option>
        )}
        {networks.map((item) => (
          <option key={deploymentKey(item)} value={deploymentKey(item)}>
            {item.chainId === 1
              ? "Ethereum"
              : item.chainId === 11155111
                ? "Sepolia"
                : `Chain ${item.chainId}`}{" "}
            · {item.contractAddress}
          </option>
        ))}
      </select>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
