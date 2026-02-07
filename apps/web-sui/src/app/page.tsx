"use client";

import * as React from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
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

export default function Page() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8788";
  const explorerTx = (process.env.NEXT_PUBLIC_SUI_EXPLORER_TX || "https://suiexplorer.com/txblock/").trim();
  const explorerObject = (process.env.NEXT_PUBLIC_SUI_EXPLORER_OBJECT || "https://suiexplorer.com/object/").trim();
  const account = useCurrentAccount();

  const [issues, setIssues] = React.useState<SuiIssueRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

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

  return (
    <main className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Sui bounties</h1>
          <p className="text-sm text-slate-600">
            Read-only viewer for the Sui indexer. Deploy this at <code className="rounded bg-slate-100 px-1">sui.clankergigs.com</code>.
          </p>
          <div className="text-xs text-slate-600">
            wallet:{" "}
            {account ? (
              <span className="font-mono">{shortHex(account.address)}</span>
            ) : (
              <span className="italic">not connected</span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <ConnectButton />
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
            onClick={() => fetchIssues()}
            disabled={loading}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </header>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      {loading ? (
        <div className="rounded-md border border-slate-200 bg-white px-3 py-6 text-sm text-slate-600">Loading…</div>
      ) : issues.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-white px-3 py-6 text-sm text-slate-600">No bounties indexed yet.</div>
      ) : (
        <div className="space-y-3">
          {issues.map((issue) => (
            <div key={issue.bountyObjectId} className="rounded-md border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <a
                    href={issue.issueUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-medium text-slate-900 hover:underline"
                  >
                    {issue.repo ? issue.repo : "repo"}#{issue.issueNumber}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  <div className="text-xs text-slate-600">
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
                <div className="text-xs text-slate-600">
                  escrowed: <span className="font-mono">{toSui(issue.escrowedMist)} SUI</span>
                </div>
              </div>

              <div className="mt-3 grid gap-2 text-xs text-slate-700 sm:grid-cols-3">
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
                <div className="mt-3 text-xs text-slate-700">
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
                <div className="mt-2 text-xs text-slate-700">
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

      <footer className="text-xs text-slate-500">
        API: <code className="rounded bg-slate-100 px-1">{apiUrl}</code>
        {" · "}
        Explorer:{" "}
        <a href={explorerTx} target="_blank" rel="noreferrer" className="hover:underline">
          tx
        </a>
      </footer>
    </main>
  );
}
