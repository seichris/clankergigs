"use client";

import * as React from "react";
import type { Hex, Address } from "viem";

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ghBountiesAbi } from "@/lib/abi";
import { ensureWalletChain, getConfig, getPublicClient, getWalletClient } from "@/lib/wallet";
import type { GithubUser } from "@/lib/hooks/useGithubUser";

export function ClaimBountyDialog({
  open,
  onOpenChange,
  walletAddress,
  bountyId,
  issueUrl,
  apiUrl,
  githubUser,
  onGithubLogin,
  onClaimed,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  walletAddress: Address | null;
  bountyId: string | null;
  issueUrl?: string | null;
  apiUrl: string;
  githubUser: GithubUser | null;
  onGithubLogin: () => void;
  onClaimed?: () => void;
}) {
  const [prUrl, setPrUrl] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setPrUrl("");
      setError(null);
    }
  }, [open]);

  const canSubmit = Boolean(walletAddress && bountyId && prUrl.trim().length > 0 && githubUser);

  async function submit() {
    if (!walletAddress) return;
    if (!githubUser) {
      setError("Connect GitHub to verify you authored this PR.");
      return;
    }
    if (!bountyId) {
      setError("Missing bounty id.");
      return;
    }
    const url = prUrl.trim();
    if (!url) {
      setError("Enter a pull request URL.");
      return;
    }
    if (!/github\.com\/[^/]+\/[^/]+\/pull\//i.test(url)) {
      setError("Please enter a valid GitHub pull request URL.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const authRes = await fetch(`${apiUrl}/claim-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          bountyId,
          claimMetadataURI: url,
          claimer: walletAddress,
        }),
      });
      const auth = (await authRes.json()) as any;
      if (!authRes.ok) {
        throw new Error(auth?.error ?? `claim-auth failed (${authRes.status})`);
      }

      const nonce = BigInt(auth.nonce);
      const deadline = BigInt(auth.deadline);
      const signature = auth.signature as `0x${string}`;

      const { contractAddress } = getConfig();
      await ensureWalletChain(Number(process.env.NEXT_PUBLIC_CHAIN_ID || "31337"));
      const wc = getWalletClient();
      const [account] = await wc.getAddresses();
      const pc = getPublicClient();

      const hash = await wc.writeContract({
        address: contractAddress,
        abi: ghBountiesAbi,
        functionName: "submitClaimWithAuthorization",
        args: [bountyId as Hex, url, nonce, deadline, signature],
        account,
      });

      await pc.waitForTransactionReceipt({ hash });
      onOpenChange(false);
      onClaimed?.();
    } catch (err: any) {
      setError(err?.shortMessage ?? err?.message ?? String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit a claim</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          {issueUrl ? (
            <div className="text-xs text-muted-foreground">Issue: {issueUrl}</div>
          ) : null}
          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <span>
              GitHub: {githubUser ? `@${githubUser.login}` : "Not connected"}
            </span>
            {!githubUser ? (
              <Button size="sm" variant="outline" onClick={onGithubLogin}>
                Connect GitHub
              </Button>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pr-url">Pull request URL</Label>
            <Input
              id="pr-url"
              placeholder="https://github.com/org/repo/pull/123"
              value={prUrl}
              onChange={(event) => setPrUrl(event.target.value)}
            />
          </div>
          {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{error}</div> : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? "Submitting..." : "Submit claim"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
