import { useCallback, useEffect, useState } from "react";

export type GithubUser = {
  login: string;
  id: number;
  avatar_url?: string | null;
};

export function useGithubUser(apiUrl: string) {
  const [user, setUser] = useState<GithubUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/auth/me`, { credentials: "include" });
      if (!res.ok) {
        setUser(null);
        setLoading(false);
        return;
      }
      const json = (await res.json()) as { user?: GithubUser };
      setUser(json?.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    refresh().catch(() => {
      // handled in refresh
    });
  }, [refresh]);

  const login = useCallback(() => {
    const returnTo = typeof window !== "undefined" ? window.location.href : "";
    window.location.href = `${apiUrl}/auth/github/start?returnTo=${encodeURIComponent(returnTo)}`;
  }, [apiUrl]);

  const logout = useCallback(async () => {
    try {
      await fetch(`${apiUrl}/auth/logout`, { method: "POST", credentials: "include" });
    } finally {
      setUser(null);
    }
  }, [apiUrl]);

  return { user, loading, login, logout, refresh };
}
