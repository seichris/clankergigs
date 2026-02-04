import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";

export function useWallet() {
  const [address, setAddress] = useState<Address | null>(null);
  const [hasProvider, setHasProvider] = useState(false);
  const [chainId, setChainId] = useState<number | null>(null);

  useEffect(() => {
    const eth = (globalThis as any).ethereum;
    setHasProvider(Boolean(eth));
    if (!eth?.request) return;

    let cancelled = false;

    eth
      .request({ method: "eth_chainId" })
      .then((cid: string) => {
        if (cancelled) return;
        const parsed = typeof cid === "string" ? Number.parseInt(cid, 16) : NaN;
        setChainId(Number.isFinite(parsed) ? parsed : null);
      })
      .catch(() => {
        if (cancelled) return;
        setChainId(null);
      });

    eth
      .request({ method: "eth_accounts" })
      .then((accounts: string[]) => {
        if (cancelled) return;
        setAddress((accounts?.[0] as Address) || null);
      })
      .catch(() => {
        if (cancelled) return;
        setAddress(null);
      });

    const handleAccountsChanged = (accounts: string[]) => {
      setAddress((accounts?.[0] as Address) || null);
    };

    const handleChainChanged = (cid: string) => {
      const parsed = typeof cid === "string" ? Number.parseInt(cid, 16) : NaN;
      setChainId(Number.isFinite(parsed) ? parsed : null);
    };

    eth.on?.("accountsChanged", handleAccountsChanged);
    eth.on?.("chainChanged", handleChainChanged);
    return () => {
      cancelled = true;
      eth.removeListener?.("accountsChanged", handleAccountsChanged);
      eth.removeListener?.("chainChanged", handleChainChanged);
    };
  }, []);

  const connect = useCallback(async () => {
    const eth = (globalThis as any).ethereum;
    if (!eth?.request) throw new Error("No injected wallet found");
    const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    const next = (accounts?.[0] as Address) || null;
    setAddress(next);
    return next;
  }, []);

  const switchChain = useCallback(async (nextChainId: number) => {
    const eth = (globalThis as any).ethereum;
    if (!eth?.request) throw new Error("No injected wallet found");
    const hex = `0x${nextChainId.toString(16)}`;
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  }, []);

  return { address, chainId, hasProvider, connect, switchChain };
}
