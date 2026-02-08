"use client";

import * as React from "react";
import { ExternalLink, Moon, MoreHorizontal, Sun } from "lucide-react";
import { ConnectButton, useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import type { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiAddress } from "@mysten/sui/utils";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { parseGitHubIssueUrl, parseGitHubPullUrl } from "@/lib/github";
import { formatMistToSui, parseSuiToMist } from "@/lib/suiUnits";
import { buildCreateBountyTx, buildFundBountyTx, buildPayoutTx, buildRefundTx, buildSubmitClaimTx } from "@/lib/suiTx";

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

type FundingReceipt = {
  receiptObjectId: string;
  bountyObjectId: string;
  amountMist: bigint;
  lockedUntilMs: bigint;
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

function badgeLabel(network: string) {
  if (network === "mainnet") return "Sui";
  if (network === "testnet") return "Sui Testnet";
  if (network === "devnet") return "Sui Devnet";
  return network;
}

function statusLabel(status: string) {
  if (status === "0") return "Open";
  if (status === "2") return "Closed";
  return status;
}

function normalizeId(id: string) {
  try {
    return normalizeSuiAddress(id);
  } catch {
    return (id || "").toLowerCase();
  }
}

function parseNonNegInt(input: string) {
  const s = input.trim();
  if (!s) return 0n;
  if (!/^[0-9]+$/.test(s)) throw new Error("Must be a non-negative integer");
  return BigInt(s);
}

function parseIdField(v: unknown) {
  if (typeof v === "string") return v;
  if (!v || typeof v !== "object") return "";

  // Some RPC responses represent IDs as `{ bytes: ... }`.
  if ("bytes" in v) {
    const bytes = (v as { bytes?: unknown }).bytes;
    try {
      if (typeof bytes === "string") {
        if (bytes.startsWith("0x")) return bytes;
        // base64 -> hex (browser-safe)
        const bin = atob(bytes);
        let hex = "";
        for (let i = 0; i < bin.length; i++) {
          hex += bin.charCodeAt(i).toString(16).padStart(2, "0");
        }
        return `0x${hex}`;
      }
      if (Array.isArray(bytes)) {
        const u8 = Uint8Array.from(bytes);
        let hex = "";
        for (const b of u8) hex += b.toString(16).padStart(2, "0");
        return `0x${hex}`;
      }
    } catch {
      return "";
    }
  }

  return "";
}

export default function Page() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8788";
  const explorerTx = (process.env.NEXT_PUBLIC_SUI_EXPLORER_TX || "https://suiexplorer.com/txblock/").trim();
  const explorerObject = (process.env.NEXT_PUBLIC_SUI_EXPLORER_OBJECT || "https://suiexplorer.com/object/").trim();
  const network = (process.env.NEXT_PUBLIC_SUI_NETWORK || "testnet").toLowerCase().trim();
  const packageId = (process.env.NEXT_PUBLIC_SUI_PACKAGE_ID || "").trim();
  const clockObjectId = (process.env.NEXT_PUBLIC_SUI_CLOCK_OBJECT_ID || "0x6").trim();

  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const signAndExecute = useSignAndExecuteTransaction();

  const [issues, setIssues] = React.useState<SuiIssueRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [mounted, setMounted] = React.useState(false);
  const [theme, setTheme] = React.useState<"light" | "dark">("light");

  const [toast, setToast] = React.useState<{ kind: "ok" | "err"; message: string; digest?: string } | null>(null);

  const [addOpen, setAddOpen] = React.useState(false);
  const [addBusy, setAddBusy] = React.useState(false);
  const [issueUrlInput, setIssueUrlInput] = React.useState("");
  const [addAmountInput, setAddAmountInput] = React.useState("");
  const [addLockSecondsInput, setAddLockSecondsInput] = React.useState("0");

  const [actionOpen, setActionOpen] = React.useState(false);
  const [actionMode, setActionMode] = React.useState<"fund" | "claim" | "payout" | "refund">("fund");
  const [selected, setSelected] = React.useState<SuiIssueRow | null>(null);

  const [fundAmountInput, setFundAmountInput] = React.useState("");
  const [fundLockSecondsInput, setFundLockSecondsInput] = React.useState("0");
  const [claimUrlInput, setClaimUrlInput] = React.useState("");
  const [payoutRecipientInput, setPayoutRecipientInput] = React.useState("");
  const [payoutAmountInput, setPayoutAmountInput] = React.useState("");

  const [receiptsLoading, setReceiptsLoading] = React.useState(false);
  const [receipts, setReceipts] = React.useState<FundingReceipt[]>([]);

  const txHref = React.useCallback((digest: string) => `${explorerTx.replace(/\/+$/, "")}/${digest}`, [explorerTx]);

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

  const refreshSoon = React.useCallback(async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 1200));
      await fetchIssues().catch(() => {});
    }
  }, [fetchIssues]);

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

  const executeTx = React.useCallback(
    async (tx: Transaction) => {
      const r = await signAndExecute.mutateAsync({ transaction: tx });
      const digest = (r as { digest?: string } | null | undefined)?.digest;
      if (!digest) throw new Error("Missing digest from wallet response");
      return digest;
    },
    [signAndExecute]
  );

  const waitForBountyCreatedId = React.useCallback(
    async (digest: string) => {
      const tx = await suiClient.waitForTransaction({ digest, options: { showEvents: true } });
      const rawEvents = (tx as { events?: unknown } | null | undefined)?.events;
      const events = Array.isArray(rawEvents) ? (rawEvents as unknown[]) : [];
      const created = events.find((e) => {
        const t = (e as { type?: unknown } | null | undefined)?.type;
        return typeof t === "string" && t.endsWith("::BountyCreated");
      }) as { parsedJson?: { bounty_id?: unknown } } | undefined;
      const bountyId = created?.parsedJson?.bounty_id;
      if (typeof bountyId !== "string" || !bountyId) throw new Error("Could not find BountyCreated event");
      return bountyId;
    },
    [suiClient]
  );

  const parseReceiptFromObject = React.useCallback((obj: unknown): FundingReceipt | null => {
    const data = (obj as { data?: unknown } | null | undefined)?.data as
      | { objectId?: unknown; content?: unknown }
      | null
      | undefined;
    const objectId = typeof data?.objectId === "string" ? data.objectId : "";
    const content = data?.content as { fields?: unknown } | null | undefined;
    const fields = content?.fields;
    if (!objectId || !fields || typeof fields !== "object") return null;

    const bountyId = parseIdField((fields as Record<string, unknown>).bounty_id);
    if (!bountyId) return null;

    try {
      const amountMist = BigInt((fields as Record<string, unknown>).amount_mist ?? "0");
      const lockedUntilMs = BigInt((fields as Record<string, unknown>).locked_until_ms ?? "0");
      return {
        receiptObjectId: objectId,
        bountyObjectId: bountyId,
        amountMist,
        lockedUntilMs,
      };
    } catch {
      return null;
    }
  }, []);

  const loadReceipts = React.useCallback(async () => {
    if (!account?.address) return;
    if (!packageId) return;

    setReceiptsLoading(true);
    try {
      const type = `${packageId}::gh_bounties::FundingReceipt`;
      const res = await suiClient.getOwnedObjects({
        owner: account.address,
        filter: { StructType: type },
        options: { showContent: true },
      });
      const parsed = (res?.data || [])
        .map((x: unknown) => parseReceiptFromObject(x))
        .filter(Boolean) as FundingReceipt[];
      setReceipts(parsed);
    } catch (err) {
      setToast({ kind: "err", message: `Failed to load receipts: ${errorMessage(err)}` });
    } finally {
      setReceiptsLoading(false);
    }
  }, [account?.address, packageId, parseReceiptFromObject, suiClient]);

  const openActions = React.useCallback((mode: typeof actionMode, issue: SuiIssueRow) => {
    setSelected(issue);
    setActionMode(mode);
    setActionOpen(true);
    setToast(null);

    if (mode === "fund") {
      setFundAmountInput("");
      setFundLockSecondsInput("0");
    } else if (mode === "claim") {
      setClaimUrlInput("");
    } else if (mode === "payout") {
      setPayoutRecipientInput("");
      setPayoutAmountInput("");
    }
  }, []);

  React.useEffect(() => {
    if (actionOpen && actionMode === "refund") {
      loadReceipts().catch(() => {});
    }
  }, [actionMode, actionOpen, loadReceipts]);

  const selectedReceipts = React.useMemo(() => {
    if (!selected) return [];
    return receipts.filter((r) => normalizeId(r.bountyObjectId) === normalizeId(selected.bountyObjectId));
  }, [receipts, selected]);

  const handleAddIssue = React.useCallback(async () => {
    setToast(null);
    if (!account?.address) return setToast({ kind: "err", message: "Connect a wallet first." });
    if (!packageId) return setToast({ kind: "err", message: "Missing NEXT_PUBLIC_SUI_PACKAGE_ID." });

    setAddBusy(true);
    try {
      const parsed = parseGitHubIssueUrl(issueUrlInput);
      const existing = issues.find(
        (i) => i.issueNumber === parsed.issueNumber && i.repo.trim().toLowerCase() === parsed.fullRepo.toLowerCase()
      );

      const amountMist = addAmountInput.trim() ? parseSuiToMist(addAmountInput) : 0n;
      const lockSeconds = parseNonNegInt(addLockSecondsInput);

      let bountyObjectId = existing?.bountyObjectId || "";
      if (!bountyObjectId) {
        const createTx = buildCreateBountyTx({
          packageId,
          repo: parsed.fullRepo,
          issueNumber: parsed.issueNumber,
          issueUrl: parsed.url,
        });
        const digest = await executeTx(createTx);
        setToast({ kind: "ok", message: "Created bounty", digest });
        bountyObjectId = await waitForBountyCreatedId(digest);
      }

      if (amountMist > 0n) {
        const fundTx = buildFundBountyTx({
          packageId,
          bountyObjectId,
          amountMist,
          lockSeconds,
          clockObjectId,
        });
        const digest = await executeTx(fundTx);
        setToast({ kind: "ok", message: "Funded bounty", digest });
      }

      setAddOpen(false);
      await refreshSoon();
    } catch (err) {
      setToast({ kind: "err", message: errorMessage(err) });
    } finally {
      setAddBusy(false);
    }
  }, [
    account?.address,
    addAmountInput,
    addLockSecondsInput,
    clockObjectId,
    executeTx,
    issueUrlInput,
    issues,
    packageId,
    refreshSoon,
    waitForBountyCreatedId,
  ]);

  const handleFundSelected = React.useCallback(async () => {
    setToast(null);
    if (!account?.address) return setToast({ kind: "err", message: "Connect a wallet first." });
    if (!packageId) return setToast({ kind: "err", message: "Missing NEXT_PUBLIC_SUI_PACKAGE_ID." });
    if (!selected) return;

    try {
      const amountMist = parseSuiToMist(fundAmountInput);
      const lockSeconds = parseNonNegInt(fundLockSecondsInput);
      const tx = buildFundBountyTx({
        packageId,
        bountyObjectId: selected.bountyObjectId,
        amountMist,
        lockSeconds,
        clockObjectId,
      });
      const digest = await executeTx(tx);
      setToast({ kind: "ok", message: "Funded", digest });
      setActionOpen(false);
      await refreshSoon();
    } catch (err) {
      setToast({ kind: "err", message: errorMessage(err) });
    }
  }, [
    account?.address,
    clockObjectId,
    executeTx,
    fundAmountInput,
    fundLockSecondsInput,
    packageId,
    refreshSoon,
    selected,
  ]);

  const handleClaimSelected = React.useCallback(async () => {
    setToast(null);
    if (!account?.address) return setToast({ kind: "err", message: "Connect a wallet first." });
    if (!packageId) return setToast({ kind: "err", message: "Missing NEXT_PUBLIC_SUI_PACKAGE_ID." });
    if (!selected) return;

    try {
      const parsed = parseGitHubPullUrl(claimUrlInput);
      if (selected.repo.trim() && parsed.fullRepo.toLowerCase() !== selected.repo.trim().toLowerCase()) {
        throw new Error(`PR repo (${parsed.fullRepo}) does not match bounty repo (${selected.repo}).`);
      }
      const tx = buildSubmitClaimTx({
        packageId,
        bountyObjectId: selected.bountyObjectId,
        claimUrl: parsed.url,
        clockObjectId,
      });
      const digest = await executeTx(tx);
      setToast({ kind: "ok", message: "Claim submitted", digest });
      setActionOpen(false);
      await refreshSoon();
    } catch (err) {
      setToast({ kind: "err", message: errorMessage(err) });
    }
  }, [account?.address, claimUrlInput, clockObjectId, executeTx, packageId, refreshSoon, selected]);

  const handlePayoutSelected = React.useCallback(async () => {
    setToast(null);
    if (!account?.address) return setToast({ kind: "err", message: "Connect a wallet first." });
    if (!packageId) return setToast({ kind: "err", message: "Missing NEXT_PUBLIC_SUI_PACKAGE_ID." });
    if (!selected) return;

    const isAdmin = normalizeId(account.address) === normalizeId(selected.admin);
    if (!isAdmin) return setToast({ kind: "err", message: "Only the bounty admin can payout." });

    try {
      const recipient = normalizeSuiAddress(payoutRecipientInput.trim());
      const amountMist = parseSuiToMist(payoutAmountInput);
      const tx = buildPayoutTx({
        packageId,
        bountyObjectId: selected.bountyObjectId,
        recipient,
        amountMist,
      });
      const digest = await executeTx(tx);
      setToast({ kind: "ok", message: "Paid out", digest });
      setActionOpen(false);
      await refreshSoon();
    } catch (err) {
      setToast({ kind: "err", message: errorMessage(err) });
    }
  }, [account?.address, executeTx, packageId, payoutAmountInput, payoutRecipientInput, refreshSoon, selected]);

  const handleRefundReceipt = React.useCallback(
    async (receipt: FundingReceipt) => {
      setToast(null);
      if (!account?.address) return setToast({ kind: "err", message: "Connect a wallet first." });
      if (!packageId) return setToast({ kind: "err", message: "Missing NEXT_PUBLIC_SUI_PACKAGE_ID." });
      if (!selected) return;

      try {
        const tx = buildRefundTx({
          packageId,
          bountyObjectId: selected.bountyObjectId,
          receiptObjectId: receipt.receiptObjectId,
          clockObjectId,
        });
        const digest = await executeTx(tx);
        setToast({ kind: "ok", message: "Refunded", digest });
        setActionOpen(false);
        await refreshSoon();
      } catch (err) {
        setToast({ kind: "err", message: errorMessage(err) });
      }
    },
    [account?.address, clockObjectId, executeTx, packageId, refreshSoon, selected]
  );

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
            <Button size="sm" onClick={() => setAddOpen(true)} disabled={!account || !packageId}>
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

        {!packageId ? (
          <div className="rounded-md border bg-card px-4 py-3 text-sm text-muted-foreground">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <p>
                Sui write flows are disabled: set{" "}
                <code className="rounded bg-accent px-1">NEXT_PUBLIC_SUI_PACKAGE_ID</code> in{" "}
                <code className="rounded bg-accent px-1">apps/web-sui/.env.local</code> (and Vercel).
              </p>
              <Button asChild variant="outline" size="sm">
                <a href="https://github.com/seichris/gh-bounties/blob/main/README-SUI.md" target="_blank" rel="noreferrer">
                  Sui docs
                </a>
              </Button>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {toast ? (
          <div
            className={[
              "rounded-md border px-3 py-2 text-sm",
              toast.kind === "ok"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-destructive/30 bg-destructive/10 text-destructive",
            ].join(" ")}
          >
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-col gap-1">
                <span className="break-all">{toast.message}</span>
                {toast.digest ? (
                  <a className="text-xs underline" href={txHref(toast.digest)} target="_blank" rel="noreferrer">
                    View transaction {shortHex(toast.digest)}
                  </a>
                ) : null}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setToast(null)} className="self-start md:self-auto">
                Dismiss
              </Button>
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
                      <Badge variant="outline">{statusLabel(issue.status)}</Badge>
                    </TableCell>
                    <TableCell className="font-mono">{formatMistToSui(issue.escrowedMist)} SUI</TableCell>
                    <TableCell className="font-mono">{shortHex(issue.admin)}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openActions("fund", issue)} disabled={!account || !packageId}>
                            Fund
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openActions("claim", issue)} disabled={!account || !packageId}>
                            Submit claim
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => openActions("payout", issue)}
                            disabled={!account || !packageId || normalizeId(account.address) !== normalizeId(issue.admin)}
                          >
                            Payout (admin)
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => openActions("refund", issue)}
                            disabled={!account || !packageId}
                          >
                            Refund (receipt)
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
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
          {" · "}
          Package: <code className="rounded bg-accent px-1">{packageId ? shortHex(packageId) : "unset"}</code>
        </footer>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Issue / Fund Bounty</DialogTitle>
            <DialogDescription>Creates a new bounty (if needed) and optionally funds it with SUI.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="issue-url">GitHub issue URL</Label>
              <Input
                id="issue-url"
                placeholder="https://github.com/owner/repo/issues/123"
                value={issueUrlInput}
                onChange={(e) => setIssueUrlInput(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="amount">Amount (SUI, optional)</Label>
              <Input
                id="amount"
                inputMode="decimal"
                placeholder="0.1"
                value={addAmountInput}
                onChange={(e) => setAddAmountInput(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="lock">Lock seconds</Label>
              <Input
                id="lock"
                inputMode="numeric"
                placeholder="0"
                value={addLockSecondsInput}
                onChange={(e) => setAddLockSecondsInput(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={addBusy}>
              Cancel
            </Button>
            <Button onClick={() => handleAddIssue().catch(() => {})} disabled={addBusy || !account || !packageId}>
              {addBusy ? "Working…" : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={actionOpen}
        onOpenChange={(v: boolean) => {
          setActionOpen(v);
          if (!v) setSelected(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionMode === "fund"
                ? "Fund Bounty"
                : actionMode === "claim"
                  ? "Submit Claim"
                  : actionMode === "payout"
                    ? "Payout"
                    : "Refund"}
            </DialogTitle>
            <DialogDescription>
              {selected ? (
                <span>
                  {selected.repo}#{selected.issueNumber} ({shortHex(selected.bountyObjectId)})
                </span>
              ) : (
                "Select a bounty"
              )}
            </DialogDescription>
          </DialogHeader>

          {actionMode === "fund" ? (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="fund-amount">Amount (SUI)</Label>
                <Input
                  id="fund-amount"
                  inputMode="decimal"
                  placeholder="0.1"
                  value={fundAmountInput}
                  onChange={(e) => setFundAmountInput(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="fund-lock">Lock seconds</Label>
                <Input
                  id="fund-lock"
                  inputMode="numeric"
                  placeholder="0"
                  value={fundLockSecondsInput}
                  onChange={(e) => setFundLockSecondsInput(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setActionOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => handleFundSelected().catch(() => {})} disabled={!selected}>
                  Fund
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {actionMode === "claim" ? (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="claim-url">GitHub PR URL</Label>
                <Input
                  id="claim-url"
                  placeholder="https://github.com/owner/repo/pull/456"
                  value={claimUrlInput}
                  onChange={(e) => setClaimUrlInput(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setActionOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => handleClaimSelected().catch(() => {})} disabled={!selected}>
                  Submit claim
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {actionMode === "payout" ? (
            <div className="grid gap-4">
              <div className="rounded-md border bg-accent/30 px-3 py-2 text-xs text-muted-foreground">
                Escrow: <span className="font-mono">{selected ? formatMistToSui(selected.escrowedMist) : "-"}</span> SUI
              </div>
              {selected?.claims && selected.claims.length > 0 ? (
                <div className="grid gap-2">
                  <div className="text-xs text-muted-foreground">Claimers</div>
                  <div className="flex flex-wrap gap-2">
                    {selected.claims.map((c) => (
                      <Button
                        key={c.claimer + c.claimUrl}
                        variant="outline"
                        size="sm"
                        onClick={() => setPayoutRecipientInput(c.claimer)}
                      >
                        {shortHex(c.claimer)}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="grid gap-2">
                <Label htmlFor="payout-recipient">Recipient</Label>
                <Input
                  id="payout-recipient"
                  placeholder="0x..."
                  value={payoutRecipientInput}
                  onChange={(e) => setPayoutRecipientInput(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="payout-amount">Amount (SUI)</Label>
                <Input
                  id="payout-amount"
                  inputMode="decimal"
                  placeholder="0.1"
                  value={payoutAmountInput}
                  onChange={(e) => setPayoutAmountInput(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setActionOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => handlePayoutSelected().catch(() => {})}
                  disabled={!selected || !account || normalizeId(account.address) !== normalizeId(selected.admin)}
                >
                  Payout
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {actionMode === "refund" ? (
            <div className="grid gap-4">
              <div className="text-xs text-muted-foreground">
                Refunds require a <span className="font-mono">FundingReceipt</span> object in your wallet, and its lock must be expired.
              </div>
              {receiptsLoading ? (
                <div className="text-sm text-muted-foreground">Loading receipts…</div>
              ) : selectedReceipts.length === 0 ? (
                <div className="text-sm text-muted-foreground">No receipts found for this bounty in the connected wallet.</div>
              ) : (
                <div className="grid gap-2">
                  {selectedReceipts.map((r) => {
                    const unlocked = BigInt(Date.now()) >= r.lockedUntilMs;
                    return (
                      <div key={r.receiptObjectId} className="flex flex-col gap-2 rounded-md border p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm">
                            <span className="font-mono">{formatMistToSui(r.amountMist)}</span> SUI
                          </div>
                          <Button size="sm" onClick={() => handleRefundReceipt(r).catch(() => {})} disabled={!unlocked}>
                            {unlocked ? "Refund" : "Locked"}
                          </Button>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Receipt:{" "}
                          <a
                            className="font-mono hover:underline"
                            href={`${explorerObject.replace(/\/+$/, "")}/${r.receiptObjectId}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {shortHex(r.receiptObjectId)}
                          </a>{" "}
                          · Unlocks: {new Date(Number(r.lockedUntilMs)).toLocaleString()}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setActionOpen(false)}>
                  Close
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}
