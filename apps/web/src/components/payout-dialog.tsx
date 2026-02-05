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
import { isProbablyEnsName } from "@/lib/ens";
import { useEnsAddressForName, useEnsPrimaryName } from "@/lib/hooks/useEns";
import { getConfig, getPublicClient, getWalletClient } from "@/lib/wallet";
import { usdcAddressForChainId } from "@gh-bounties/shared";

const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";

type Mode = "repo" | "funder" | "dao";

type PayoutAuthResponse = {
  nonce: string;
  deadline: string;
  signature: Hex;
  error?: string;
  received?: unknown;
};

function errorMessage(err: unknown) {
  if (err && typeof err === "object") {
    const maybe = err as { shortMessage?: unknown; message?: unknown };
    if (typeof maybe.shortMessage === "string" && maybe.shortMessage) return maybe.shortMessage;
    if (typeof maybe.message === "string" && maybe.message) return maybe.message;
  }
  return String(err);
}

export function PayoutDialog({
  open,
  onOpenChange,
  walletAddress,
  bountyId,
  issueUrl,
  apiUrl,
  mode,
  onPayouted,
  escrowedByToken,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  walletAddress: Address | null;
  bountyId: string | null;
  issueUrl?: string | null;
  apiUrl: string;
  mode: Mode;
  onPayouted?: () => void;
  escrowedByToken?: Record<string, string>;
}) {
  const [asset, setAsset] = React.useState<"ETH" | "USDC">("ETH");
  const [recipient, setRecipient] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const recipientTrimmed = recipient.trim();
  const recipientIsAddress = Boolean(recipientTrimmed && isAddress(recipientTrimmed));
  const recipientLooksEns = Boolean(recipientTrimmed && !recipientIsAddress && isProbablyEnsName(recipientTrimmed));
  const { address: ensResolvedAddress, isLoading: ensIsResolving } = useEnsAddressForName(
    recipientLooksEns ? recipientTrimmed : null
  );
  const { name: reverseEnsName, isLoading: ensReverseIsResolving } = useEnsPrimaryName(
    recipientIsAddress ? (recipientTrimmed as Address) : null
  );
  const resolvedRecipient = (recipientIsAddress ? recipientTrimmed : ensResolvedAddress) as Address | null;

  React.useEffect(() => {
    if (open) {
      setAsset("ETH");
      setRecipient("");
      setAmount("");
      setError(null);
    }
  }, [open]);

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "31337");
  const usdcAddress = usdcAddressForChainId(chainId);

  const title =
    mode === "repo"
      ? "Repo owner payout"
      : mode === "funder"
        ? "Funder payout"
        : "DAO payout";

  const tokenAddress = asset === "ETH" ? ETH_ADDRESS : (usdcAddress || "");
  const escrowedRaw = escrowedByToken && tokenAddress
    ? escrowedByToken[tokenAddress.toLowerCase()] || "0"
    : "0";
  const escrowedDisplay = (() => {
    try {
      const decimals = asset === "ETH" ? 18 : 6;
      return formatUnits(BigInt(escrowedRaw), decimals);
    } catch {
      return escrowedRaw;
    }
  })();

  const canSubmit = Boolean(
    walletAddress &&
      bountyId &&
      resolvedRecipient &&
      amount &&
      (!usdcAddress ? asset === "ETH" : true)
  );

  async function submit() {
    if (!walletAddress) return;
    if (!bountyId) {
      setError("Missing bounty id.");
      return;
    }
    if (!resolvedRecipient) {
      setError(recipientLooksEns ? "ENS name did not resolve to an address." : "Enter a valid recipient address.");
      return;
    }
    if (!amount || Number(amount) <= 0) {
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
      const { contractAddress } = getConfig();
      const wc = getWalletClient();
      const [account] = await wc.getAddresses();
      const pc = getPublicClient();

      const token = asset === "ETH" ? ETH_ADDRESS : (usdcAddress as Address);
      const decimals = asset === "ETH" ? 18 : 6;
      const amountWei = asset === "ETH" ? parseEther(amount) : parseUnits(amount, decimals);

      if (mode === "repo") {
        const authRes = await fetch(`${apiUrl}/payout-auth`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            bountyId,
            token,
            recipient: resolvedRecipient,
            amountWei: amountWei.toString(),
          }),
        });
        const auth = (await authRes.json()) as Partial<PayoutAuthResponse>;
        if (!authRes.ok) {
          throw new Error(
            `${auth?.error ?? `payout-auth failed (${authRes.status})`} ${auth?.received ? `received=${auth.received}` : ""}`.trim()
          );
        }

        if (!auth.nonce || !auth.deadline || !auth.signature) {
          throw new Error("Invalid payout-auth response.");
        }

        const nonce = BigInt(auth.nonce);
        const deadline = BigInt(auth.deadline);
        const signature = auth.signature as Hex;

        const hash = await wc.writeContract({
          address: contractAddress,
          abi: ghBountiesAbi,
          functionName: "payoutWithAuthorization",
          args: [bountyId as Hex, token as Address, resolvedRecipient, amountWei, nonce, deadline, signature],
          account,
        });
        await pc.waitForTransactionReceipt({ hash });
      } else if (mode === "funder") {
        const hash = await wc.writeContract({
          address: contractAddress,
          abi: ghBountiesAbi,
          functionName: "funderPayout",
          args: [bountyId as Hex, token as Address, resolvedRecipient, amountWei],
          account,
        });
        await pc.waitForTransactionReceipt({ hash });
      } else {
        const hash = await wc.writeContract({
          address: contractAddress,
          abi: ghBountiesAbi,
          functionName: "daoPayout",
          args: [bountyId as Hex, token as Address, resolvedRecipient, amountWei],
          account,
        });
        await pc.waitForTransactionReceipt({ hash });
      }

      onOpenChange(false);
      onPayouted?.();
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          {issueUrl ? <div className="text-xs text-muted-foreground">Issue: {issueUrl}</div> : null}
          <div className="grid gap-2">
            <Label>Funding asset</Label>
            <Select value={asset} onValueChange={(value) => setAsset(value as "ETH" | "USDC")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select asset" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ETH">ETH</SelectItem>
                <SelectItem value="USDC">ERC20 (USDC)</SelectItem>
              </SelectContent>
            </Select>
            {asset === "USDC" && !usdcAddress ? (
              <div className="text-xs text-amber-600">USDC is not configured for chain {chainId}.</div>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="recipient">Recipient</Label>
            <Input
              id="recipient"
              placeholder="0x... or alice.eth"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
            />
            {recipientLooksEns ? (
              <div className="text-xs text-muted-foreground">
                {ensIsResolving ? (
                  "Resolving ENS name…"
                ) : ensResolvedAddress ? (
                  <>Resolves to: <span className="font-mono">{ensResolvedAddress}</span></>
                ) : (
                  "No address found for this ENS name."
                )}
              </div>
            ) : recipientIsAddress ? (
              reverseEnsName ? (
                <div className="text-xs text-muted-foreground">
                  Reverse ENS: <span className="font-mono">{reverseEnsName}</span>
                </div>
              ) : ensReverseIsResolving ? (
                <div className="text-xs text-muted-foreground">Reverse-resolving ENS name…</div>
              ) : null
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="amount">Amount</Label>
            <Input id="amount" value={amount} onChange={(event) => setAmount(event.target.value)} />
            <div className="text-xs text-muted-foreground">In active bounty: {escrowedDisplay}</div>
          </div>
          {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{error}</div> : null}
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
