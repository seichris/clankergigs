import * as React from "react";
import type { Address } from "viem";
import { getEnsAddress, getEnsAvatar, getEnsName, getEnsText, normalize } from "viem/ens";

import { getEnsPublicClient, isProbablyEnsName } from "@/lib/ens";

function safeNormalizeEnsName(value: string) {
  try {
    return normalize(value);
  } catch {
    return null;
  }
}

export function useEnsPrimaryName(address: Address | null) {
  const [name, setName] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!address) {
      setName(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    getEnsName(getEnsPublicClient(), { address })
      .then((next) => {
        if (cancelled) return;
        setName(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setName(null);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  return { name, isLoading, error };
}

export function useEnsAddressForName(name: string | null) {
  const [address, setAddress] = React.useState<Address | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const trimmed = (name || "").trim();
    if (!trimmed) {
      setAddress(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    if (!isProbablyEnsName(trimmed)) {
      setAddress(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const normalized = safeNormalizeEnsName(trimmed);
    if (!normalized) {
      setAddress(null);
      setIsLoading(false);
      setError("Invalid ENS name.");
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    getEnsAddress(getEnsPublicClient(), { name: normalized })
      .then((next) => {
        if (cancelled) return;
        setAddress(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setAddress(null);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [name]);

  return { address, isLoading, error };
}

export function useEnsAvatarUrl(name: string | null) {
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const trimmed = (name || "").trim();
    if (!trimmed) {
      setAvatarUrl(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const normalized = safeNormalizeEnsName(trimmed);
    if (!normalized) {
      setAvatarUrl(null);
      setIsLoading(false);
      setError("Invalid ENS name.");
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    getEnsAvatar(getEnsPublicClient(), { name: normalized })
      .then((next) => {
        if (cancelled) return;
        setAvatarUrl(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setAvatarUrl(null);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [name]);

  return { avatarUrl, isLoading, error };
}

export function useEnsTextRecord(name: string | null, key: string) {
  const [value, setValue] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const trimmed = (name || "").trim();
    if (!trimmed || !key) {
      setValue(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const normalized = safeNormalizeEnsName(trimmed);
    if (!normalized) {
      setValue(null);
      setIsLoading(false);
      setError("Invalid ENS name.");
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    getEnsText(getEnsPublicClient(), { name: normalized, key })
      .then((next) => {
        if (cancelled) return;
        setValue(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setValue(null);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [name, key]);

  return { value, isLoading, error };
}
