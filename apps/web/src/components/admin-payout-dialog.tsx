"use client";

import * as React from "react";
import type { Address, Hex } from "viem";
import { formatUnits, isAddress, parseEther, parseUnits } from "viem";

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ghBountiesAbi } from "@/lib/abi";
import { ensureWalletChain, getConfig, getPublicClient, getWalletClient } from "@/lib/wallet";
import { usdcAddressForChainId } from "@gh-bounties/shared";
import type { GithubUser } from "@/lib/hooks/useGithubUser";

const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";

type AssetChoice = "ALL" | "ETH" | "USDC";

export function AdminPayoutDialog({
  open,
  onOpenChange,
  walletAddress,
  bountyId,
  issueUrl,
  apiUrl,
  escrowedByToken,
  githubUser,
  onGithubLogin,
  onPayouted,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  walletAddress: Address | null;
  bountyId: string | null;
  issueUrl?: string | null;
  apiUrl: string;
  escrowedByToken?: Record<string, string>;
  githubUser: GithubUser | null;
  onGithubLogin: () => void;
  onPayouted?: () => void;
}) {
  const [asset, setAsset] = React.useState<AssetChoice>("ALL");
  const [recipient, setRecipient] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [autoAmount, setAutoAmount] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "31337");
  const usdcAddress = usdcAddressForChainId(chainId);

  const escrowedEth = escrowedByToken?.[ETH_ADDRESS.toLowerCase()] || "0";
  const escrowedUsdc = usdcAddress ? escrowedByToken?.[usdcAddress.toLowerCase()] || "0" : "0";

  const hasAnyOnchain = (() => {
    try {
      return BigInt(escrowedEth) > 0n || BigInt(escrowedUsdc) > 0n;
    } catch {
      return false;
    }
  })();

  const maxForAsset = React.useMemo(() => {
    if (asset === "ETH") return { raw: escrowedEth, decimals: 18 };
    if (asset === "USDC") return { raw: escrowedUsdc, decimals: 6 };
    return { raw: "0", decimals: 6 };
  }, [asset, escrowedEth, escrowedUsdc]);

  const maxDisplay = React.useMemo(() => {
    try {
      return formatUnits(BigInt(maxForAsset.raw || "0"), maxForAsset.decimals);
    } catch {
      return "0";
    }
  }, [maxForAsset]);

  React.useEffect(() => {
    if (!open) return;
    setRecipient(walletAddress || "");
    setError(null);
    setAutoAmount(true);
  }, [open, walletAddress]);

  React.useEffect(() => {
    if (!open) return;
    if (hasAnyOnchain) {
      setAsset("ALL");
    } else {
      setAsset("ETH");
    }
  }, [open, hasAnyOnchain]);

  React.useEffect(() => {
    if (!open) return;
    if (asset === "ALL") {
      setAmount("");
      return;
    }
    if (!autoAmount) return;
    setAmount(maxDisplay);
  }, [open, asset, maxDisplay, autoAmount]);

  const canSubmit = Boolean(walletAddress && bountyId && isAddress(recipient) && githubUser);

  async function submitOnchainPayout(opts: { token: Address; amountWei: bigint }) {
    if (!bountyId) throw new Error("Missing bounty id.");
    const { contractAddress } = getConfig();
    await ensureWalletChain(chainId);
    const wc = getWalletClient();
    const [account] = await wc.getAddresses();
    const pc = getPublicClient();

    const authRes = await fetch(`${apiUrl}/payout-auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        bountyId,
        token: opts.token,
        recipient: recipient.trim(),
        amountWei: opts.amountWei.toString(),
      }),
    });
    const auth = (await authRes.json()) as any;
    if (!authRes.ok) {
      throw new Error(
        `${auth?.error ?? `payout-auth failed (${authRes.status})`} ${auth?.received ? `received=${auth.received}` : ""}`.trim()
      );
    }

    const nonce = BigInt(auth.nonce);
    const deadline = BigInt(auth.deadline);
    const signature = auth.signature as Hex;

    const hash = await wc.writeContract({
      address: contractAddress,
      abi: ghBountiesAbi,
      functionName: "payoutWithAuthorization",
      args: [bountyId as Hex, opts.token, recipient.trim() as Address, opts.amountWei, nonce, deadline, signature],
      account,
    });
    await pc.waitForTransactionReceipt({ hash });
  }

  async function submit() {
    if (!walletAddress) return;
    if (!bountyId) {
      setError("Missing bounty id.");
      return;
    }
    if (!recipient.trim() || !isAddress(recipient.trim())) {
      setError("Enter a valid recipient address.");
      return;
    }
    if (!githubUser) {
      setError("Connect GitHub (repo admin) to approve payouts.");
      return;
    }
    if (asset !== "ALL" && (!amount || Number(amount) <= 0)) {
      setError("Enter a valid amount.");
      return;
    }
    if (asset === "USDC" && !usdcAddress) {
      setError("USDC is not configured for this chain.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      let didSubmit = false;

      if (asset === "ALL" || asset === "ETH") {
        const amountWei = asset === "ALL" ? BigInt(escrowedEth || "0") : parseEther(amount);
        if (amountWei > 0n) {
          await submitOnchainPayout({ token: ETH_ADDRESS, amountWei });
          didSubmit = true;
        }
      }

      if (asset === "ALL" || asset === "USDC") {
        if (!usdcAddress) throw new Error("USDC is not configured for this chain.");
        const amountWei = asset === "ALL" ? BigInt(escrowedUsdc || "0") : parseUnits(amount, 6);
        if (amountWei > 0n) {
          await submitOnchainPayout({ token: usdcAddress as Address, amountWei });
          didSubmit = true;
        }
      }

      if (!didSubmit) {
        throw new Error("No payoutable balance available for the selected asset.");
      }

      onOpenChange(false);
      onPayouted?.();
    } catch (err: any) {
      setError(err?.shortMessage ?? err?.message ?? String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  const allSummary = [
    `ETH: ${formatUnits(BigInt(escrowedEth || "0"), 18)}`,
    `USDC: ${formatUnits(BigInt(escrowedUsdc || "0"), 6)}`,
  ]
    .filter(Boolean)
    .join(" • ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Admin payout</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          {issueUrl ? <div className="text-xs text-muted-foreground">Issue: {issueUrl}</div> : null}
          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <span>GitHub: {githubUser ? `@${githubUser.login}` : "Not connected"}</span>
            {!githubUser ? (
              <Button size="sm" variant="outline" onClick={onGithubLogin}>
                Connect GitHub
              </Button>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label>Asset</Label>
            <Select
              value={asset}
              onValueChange={(value) => {
                setAsset(value as AssetChoice);
                setAutoAmount(true);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select asset" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All assets</SelectItem>
                <SelectItem value="ETH">ETH (escrow)</SelectItem>
                <SelectItem value="USDC">USDC (escrow)</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground">
              {asset === "ALL" ? allSummary : `Max: ${maxDisplay}`}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="recipient">Recipient</Label>
            <Input
              id="recipient"
              placeholder="0x..."
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="amount">Amount</Label>
            <Input
              id="amount"
              value={amount}
              disabled={asset === "ALL"}
              onChange={(event) => {
                setAmount(event.target.value);
                setAutoAmount(false);
              }}
            />
            {asset !== "ALL" ? (
              <Button
                size="sm"
                variant="outline"
                className="w-fit"
                onClick={() => {
                  setAmount(maxDisplay);
                  setAutoAmount(true);
                }}
              >
                Use max
              </Button>
            ) : null}
          </div>

          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? "Submitting..." : "Submit payout"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
