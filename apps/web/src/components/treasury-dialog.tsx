"use client";

import * as React from "react";
import { formatUnits, isAddress, parseUnits, type Address } from "viem";

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { GithubUser } from "@/lib/hooks/useGithubUser";

function fmtUsdcSubunits(value: string | null | undefined) {
  try {
    return formatUnits(BigInt(value || "0"), 6);
  } catch {
    return "0";
  }
}

export function TreasuryDialog({
  open,
  onOpenChange,
  apiUrl,
  bountyId,
  issueUrl,
  walletAddress,
  githubUser,
  onGithubLogin,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  apiUrl: string;
  bountyId: string | null;
  issueUrl?: string | null;
  walletAddress: Address | null;
  githubUser: GithubUser | null;
  onGithubLogin: () => void;
}) {
  const [ledger, setLedger] = React.useState<any | null>(null);
  const [fundings, setFundings] = React.useState<any[]>([]);
  const [payouts, setPayouts] = React.useState<any[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [isRepoAdmin, setIsRepoAdmin] = React.useState(false);
  const [adminLoading, setAdminLoading] = React.useState(false);

  const [recipient, setRecipient] = React.useState<string>("");
  const [destinationChain, setDestinationChain] = React.useState<string>("Base_Sepolia");
  const [amount, setAmount] = React.useState<string>("");
  const [autoAmount, setAutoAmount] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const maxAvailable = fmtUsdcSubunits(ledger?.availableUsdc);

  const refresh = React.useCallback(async () => {
    if (!bountyId) return;
    setLoading(true);
    setError(null);
    try {
      const [ledgerRes, fundRes, payoutRes] = await Promise.all([
        fetch(`${apiUrl}/treasury/ledger?bountyId=${encodeURIComponent(bountyId)}`),
        fetch(`${apiUrl}/treasury/funding-intents?bountyId=${encodeURIComponent(bountyId)}`),
        fetch(`${apiUrl}/treasury/payout-intents?bountyId=${encodeURIComponent(bountyId)}`),
      ]);
      const ledgerJson = await ledgerRes.json();
      const fundJson = await fundRes.json();
      const payoutJson = await payoutRes.json();
      setLedger(ledgerJson?.ledger ?? null);
      setFundings(fundJson?.intents ?? []);
      setPayouts(payoutJson?.intents ?? []);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [apiUrl, bountyId]);

  React.useEffect(() => {
    if (!open) return;
    setRecipient(walletAddress || "");
    setAutoAmount(true);
    refresh().catch(() => {
      // handled in refresh
    });
  }, [open, refresh, walletAddress]);

  React.useEffect(() => {
    if (!open || !bountyId) {
      setIsRepoAdmin(false);
      return;
    }
    setAdminLoading(true);
    fetch(`${apiUrl}/treasury/admin?bountyId=${encodeURIComponent(bountyId)}`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          setIsRepoAdmin(false);
          return;
        }
        const json = (await res.json()) as { isAdmin?: boolean };
        setIsRepoAdmin(Boolean(json?.isAdmin));
      })
      .catch(() => setIsRepoAdmin(false))
      .finally(() => setAdminLoading(false));
  }, [open, bountyId, apiUrl]);

  React.useEffect(() => {
    if (!open) return;
    if (!autoAmount) return;
    setAmount(maxAvailable);
  }, [open, autoAmount, maxAvailable]);

  const canSubmit = Boolean(bountyId && isAddress(recipient) && Number(amount) > 0 && githubUser);

  async function submitPayout() {
    if (!bountyId) return;
    if (!githubUser) {
      setError("Connect GitHub (repo admin) to approve payouts.");
      return;
    }
    if (!isAddress(recipient)) {
      setError("Enter a valid recipient address.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // Validate amount early for better errors.
      parseUnits(amount, 6);
      const res = await fetch(`${apiUrl}/treasury/payout-intents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          bountyId,
          recipient,
          destinationChain,
          amountUsdc: amount,
        }),
      });
      const json = (await res.json()) as any;
      if (!res.ok) throw new Error(json?.error ?? `Failed to create payout intent (${res.status})`);
      await refresh();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Treasury (USDC)</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          {issueUrl ? <div className="text-xs text-muted-foreground">Issue: {issueUrl}</div> : null}

          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}

          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            {loading ? (
              "Loading treasury…"
            ) : (
              <>
                <div>Available: {fmtUsdcSubunits(ledger?.availableUsdc)} USDC</div>
                <div>Funded: {fmtUsdcSubunits(ledger?.totalFundedUsdc)} USDC</div>
                <div>Paid: {fmtUsdcSubunits(ledger?.totalPaidUsdc)} USDC</div>
              </>
            )}
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <span>GitHub: {githubUser ? `@${githubUser.login}` : "Not connected"}</span>
              {!githubUser ? (
                <Button size="sm" variant="outline" onClick={onGithubLogin}>
                  Connect GitHub
                </Button>
              ) : null}
            </div>
          </div>

          {isRepoAdmin ? (
            <div className="grid gap-3 rounded-md border p-3">
              <div className="text-sm font-medium">Create payout intent</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Destination chain</Label>
                  <Select value={destinationChain} onValueChange={setDestinationChain}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select chain" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Arc_Testnet">Arc Testnet</SelectItem>
                      <SelectItem value="Base_Sepolia">Base Sepolia</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Amount (USDC)</Label>
                  <Input
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setAutoAmount(false);
                    }}
                  />
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Max: {maxAvailable} USDC</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAmount(maxAvailable);
                        setAutoAmount(true);
                      }}
                    >
                      Use max
                    </Button>
                  </div>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Recipient</Label>
                <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x…" />
              </div>
              <Button onClick={submitPayout} disabled={!canSubmit || submitting}>
                {submitting ? "Creating..." : "Create payout"}
              </Button>
              <div className="text-xs text-muted-foreground">
                Payouts execute automatically in the background (orchestrator).
              </div>
            </div>
          ) : (
            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              {adminLoading
                ? "Checking repo admin permissions..."
                : githubUser
                  ? "Repo admin required to create treasury payouts."
                  : "Connect GitHub to check repo admin permissions."}
            </div>
          )}

          <div className="grid gap-3">
            <div className="text-sm font-medium">Recent fundings</div>
            <div className="rounded-md border">
              <div className="grid grid-cols-4 gap-2 border-b px-3 py-2 text-[11px] text-muted-foreground">
                <div>Status</div>
                <div>Amount</div>
                <div>Sender</div>
                <div>Arc tx</div>
              </div>
              {(fundings ?? []).slice(0, 6).map((f) => (
                <div key={f.id} className="grid grid-cols-4 gap-2 px-3 py-2 text-xs">
                  <div className="text-muted-foreground">{f.status}</div>
                  <div>{fmtUsdcSubunits(f.amountUsdc)} USDC</div>
                  <div className="font-mono text-muted-foreground">{String(f.sender || "").slice(0, 10)}…</div>
                  <div className="font-mono text-muted-foreground">{f.arcMintTxHash ? String(f.arcMintTxHash).slice(0, 10) + "…" : "-"}</div>
                </div>
              ))}
              {(!fundings || fundings.length === 0) && !loading ? (
                <div className="px-3 py-3 text-xs text-muted-foreground">No treasury fundings yet.</div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3">
            <div className="text-sm font-medium">Recent payouts</div>
            <div className="rounded-md border">
              <div className="grid grid-cols-4 gap-2 border-b px-3 py-2 text-[11px] text-muted-foreground">
                <div>Status</div>
                <div>Amount</div>
                <div>Dest</div>
                <div>Tx</div>
              </div>
              {(payouts ?? []).slice(0, 6).map((p) => (
                <div key={p.id} className="grid grid-cols-4 gap-2 px-3 py-2 text-xs">
                  <div className="text-muted-foreground">{p.status}</div>
                  <div>{fmtUsdcSubunits(p.amountUsdc)} USDC</div>
                  <div className="text-muted-foreground">{p.destinationChain}</div>
                  <div className="font-mono text-muted-foreground">{p.finalTxHash ? String(p.finalTxHash).slice(0, 10) + "…" : "-"}</div>
                </div>
              ))}
              {(!payouts || payouts.length === 0) && !loading ? (
                <div className="px-3 py-3 text-xs text-muted-foreground">No treasury payouts yet.</div>
              ) : null}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button variant="outline" onClick={() => refresh()} disabled={!bountyId || loading}>
            Refresh
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
