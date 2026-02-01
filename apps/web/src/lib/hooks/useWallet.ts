import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";

export function useWallet() {
  const [address, setAddress] = useState<Address | null>(null);
  const [hasProvider, setHasProvider] = useState(false);

  useEffect(() => {
    const eth = (globalThis as any).ethereum;
    setHasProvider(Boolean(eth));
    if (!eth?.request) return;

    let cancelled = false;

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

    eth.on?.("accountsChanged", handleAccountsChanged);
    return () => {
      cancelled = true;
      eth.removeListener?.("accountsChanged", handleAccountsChanged);
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

  return { address, hasProvider, connect };
}
