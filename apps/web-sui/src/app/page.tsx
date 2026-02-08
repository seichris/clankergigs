"use client";

import * as React from "react";
import { ExternalLink, Moon, MoreHorizontal, Sun } from "lucide-react";
import { ConnectButton, useCurrentAccount } from "@mysten/dapp-kit";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
  const [fundCtaOpen, setFundCtaOpen] = React.useState(false);
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

  const handleAddIssue = React.useCallback(() => {
    // Sui web is currently read-only. This keeps UI parity with EVM web without
    // pretending the write flows are available yet.
    setFundCtaOpen(true);
  }, []);

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full flex-col gap-8 px-6 py-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">ClankerGigs</h1>
            <p className="text-sm text-muted-foreground">
              Fund any Github issue. Claim rewards for solving it. Built for Humans and AI Agents like OpenClaw (start at{" "}
              <a
                href="https://github.com/seichris/gh-bounties/blob/main/AGENTS.md"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                AGENTS.md
              </a>
              ).
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" title="Configured by NEXT_PUBLIC_SUI_NETWORK">
              {badgeLabel(network)}
            </Badge>
            <Button size="sm" onClick={handleAddIssue} disabled={!account}>
              Add issue / fund bounty
            </Button>
            <ConnectButton
              className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              connectText={account ? shortHex(account.address) : "Connect wallet"}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                  <Avatar>
                    <AvatarFallback>GH</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled>GitHub auth not wired for Sui yet</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a href="https://github.com/seichris/gh-bounties" target="_blank" rel="noopener noreferrer">
                    View repo
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon"
              className="hover:bg-transparent active:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
              onClick={toggleTheme}
              aria-label="Toggle dark mode"
              disabled={!mounted}
            >
              {mounted && theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </header>

        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {fundCtaOpen ? (
          <div className="rounded-md border bg-card px-4 py-3 text-sm text-muted-foreground">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <p>
                The Sui web UI is currently read-only (viewer). The button is here for parity with mainnet/sepolia; write
                flows (create/fund/claim/payout) are still TODO.
              </p>
              <div className="flex items-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <a
                    href="https://github.com/seichris/gh-bounties/blob/main/README-SUI.md"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Sui docs
                  </a>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setFundCtaOpen(false)}>
                  Dismiss
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Issue</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>In active bounty</TableHead>
                <TableHead>Admin</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="px-4 py-6 text-sm text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : issues.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="px-4 py-6 text-sm text-muted-foreground">
                    No bounties indexed yet.
                  </TableCell>
                </TableRow>
              ) : (
                issues.map((issue) => (
                  <TableRow key={issue.bountyObjectId}>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <a
                          href={issue.issueUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-medium hover:underline"
                        >
                          {issue.repo ? issue.repo : "repo"}#{issue.issueNumber}
                          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                        </a>
                        <a
                          href={`${explorerObject.replace(/\/+$/, "")}/${issue.bountyObjectId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-xs text-muted-foreground hover:underline"
                        >
                          {shortHex(issue.bountyObjectId)}
                        </a>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{issue.status}</Badge>
                    </TableCell>
                    <TableCell className="font-mono">{toSui(issue.escrowedMist)} SUI</TableCell>
                    <TableCell className="font-mono">{shortHex(issue.admin)}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <a
                              href={`${explorerObject.replace(/\/+$/, "")}/${issue.bountyObjectId}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View bounty object
                            </a>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem asChild>
                            <a href={issue.issueUrl} target="_blank" rel="noreferrer">
                              View GitHub issue
                            </a>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

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
