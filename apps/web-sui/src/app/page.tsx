"use client";

import * as React from "react";
import { ChevronDown, ExternalLink, Moon, RefreshCw, Sun } from "lucide-react";
import { ConnectButton, useCurrentAccount } from "@mysten/dapp-kit";

type SuiFunding = {
  funder: string;
  amountMist: string;
  lockedUntilMs: string;
  createdAt: string;
};

type SuiClaim = {
  claimer: string;
  claimUrl: string;
  createdAt: string;
};

type SuiPayout = {
  recipient: string;
  amountMist: string;
  createdAt: string;
};

type SuiRefund = {
  funder: string;
  amountMist: string;
  createdAt: string;
};

type SuiIssueRow = {
  bountyObjectId: string;
  repo: string;
  issueNumber: number;
  issueUrl: string;
  admin: string;
  status: string;
  fundedMist: string;
  escrowedMist: string;
  paidMist: string;
  createdAt: string;
  updatedAt: string;
  fundings?: SuiFunding[];
  claims?: SuiClaim[];
  payouts?: SuiPayout[];
  refunds?: SuiRefund[];
};

function errorMessage(err: unknown) {
  if (typeof err === "object" && err !== null && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg.length > 0) return msg;
  }
  return String(err);
}

function shortHex(s: string) {
  if (!s) return "";
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function toSui(mistStr: string) {
  try {
    const mist = BigInt(mistStr || "0");
    const whole = mist / 1_000_000_000n;
    const frac = mist % 1_000_000_000n;
    const fracStr = frac.toString().padStart(9, "0").replace(/0+$/, "");
    return fracStr ? `${whole}.${fracStr}` : `${whole}`;
  } catch {
    return "-";
  }
}

function badgeLabel(network: string) {
  if (network === "mainnet") return "Sui";
  if (network === "testnet") return "Sui Testnet";
  if (network === "devnet") return "Sui Devnet";
  return network;
}

export default function Page() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8788";
  const explorerTx = (process.env.NEXT_PUBLIC_SUI_EXPLORER_TX || "https://suiexplorer.com/txblock/").trim();
  const explorerObject = (process.env.NEXT_PUBLIC_SUI_EXPLORER_OBJECT || "https://suiexplorer.com/object/").trim();
  const network = (process.env.NEXT_PUBLIC_SUI_NETWORK || "testnet").toLowerCase().trim();
  const account = useCurrentAccount();

  const [issues, setIssues] = React.useState<SuiIssueRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [mounted, setMounted] = React.useState(false);
  const [theme, setTheme] = React.useState<"light" | "dark">("light");

  const fetchIssues = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/issues`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load issues (${res.status})`);
      const json = (await res.json()) as { issues?: SuiIssueRow[] };
      setIssues(json?.issues ?? []);
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  React.useEffect(() => {
    fetchIssues().catch(() => {});
  }, [fetchIssues]);

  React.useEffect(() => {
    setMounted(true);
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  const toggleTheme = React.useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("ghb-theme", next);
    } catch {}
    setTheme(next);
  }, [theme]);

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Sui prototype UI. Read-only indexer viewer today. Wallet connect is wired for upcoming write flows.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
              title="Configured by NEXT_PUBLIC_SUI_NETWORK"
            >
              {badgeLabel(network)}
              <ChevronDown className="ml-2 h-4 w-4 opacity-60" />
            </span>
            <ConnectButton
              className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              connectText={account ? shortHex(account.address) : "Connect wallet"}
            />
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              disabled={!mounted}
            >
              {mounted && theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              onClick={() => fetchIssues()}
              disabled={loading}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </header>

        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-md border bg-card px-4 py-6 text-sm text-muted-foreground">Loading…</div>
        ) : issues.length === 0 ? (
          <div className="rounded-md border bg-card px-4 py-6 text-sm text-muted-foreground">No bounties indexed yet.</div>
        ) : (
          <div className="space-y-3">
            {issues.map((issue) => (
              <div key={issue.bountyObjectId} className="rounded-md border bg-card p-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <a
                      href={issue.issueUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
                    >
                      {issue.repo ? issue.repo : "repo"}#{issue.issueNumber}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <div className="text-xs text-muted-foreground">
                      bounty object:{" "}
                      <a
                        href={`${explorerObject.replace(/\/+$/, "")}/${issue.bountyObjectId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono hover:underline"
                      >
                        {shortHex(issue.bountyObjectId)}
                      </a>
                      {" · "}
                      admin: <span className="font-mono">{shortHex(issue.admin)}</span>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    escrowed: <span className="font-mono">{toSui(issue.escrowedMist)} SUI</span>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 text-xs text-foreground/90 sm:grid-cols-3">
                  <div>
                    funded: <span className="font-mono">{toSui(issue.fundedMist)} SUI</span>
                  </div>
                  <div>
                    paid: <span className="font-mono">{toSui(issue.paidMist)} SUI</span>
                  </div>
                  <div>
                    status: <span className="font-mono">{issue.status}</span>
                  </div>
                </div>

                {issue.claims && issue.claims.length > 0 ? (
                  <div className="mt-3 text-xs text-foreground/90">
                    claims:{" "}
                    {issue.claims.slice(0, 3).map((c, idx) => (
                      <span key={`${c.claimer}-${idx}`}>
                        {idx ? ", " : ""}
                        <span className="font-mono">{shortHex(c.claimer)}</span>
                        {c.claimUrl ? (
                          <>
                            {" ("}
                            <a href={c.claimUrl} target="_blank" rel="noreferrer" className="hover:underline">
                              link
                            </a>
                            {")"}
                          </>
                        ) : null}
                      </span>
                    ))}
                    {issue.claims.length > 3 ? ` (+${issue.claims.length - 3} more)` : ""}
                  </div>
                ) : null}

                {issue.fundings && issue.fundings.length > 0 ? (
                  <div className="mt-2 text-xs text-foreground/90">
                    funders:{" "}
                    {Array.from(new Set(issue.fundings.map((f) => f.funder.toLowerCase())))
                      .slice(0, 4)
                      .map((f, idx) => (
                        <span key={f}>
                          {idx ? ", " : ""}
                          <span className="font-mono">{shortHex(f)}</span>
                        </span>
                      ))}
                    {issue.fundings.length > 4 ? "…" : ""}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}

        <footer className="text-xs text-muted-foreground">
          API: <code className="rounded bg-accent px-1">{apiUrl}</code>
          {" · "}
          Explorer:{" "}
          <a href={explorerTx} target="_blank" rel="noreferrer" className="hover:underline">
            tx
          </a>
        </footer>
      </div>
    </main>
  );
}
