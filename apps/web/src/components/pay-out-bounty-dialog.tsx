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

type Mode = "repo" | "funder";
type AssetChoiceRepo = "ALL" | "ETH" | "USDC";
type AssetChoiceFunder = "ETH" | "USDC";

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

export function PayOutBountyDialog({
  open,
  onOpenChange,
  walletAddress,
  onWalletConnect,
  githubUser,
  onGithubLogin,
  bountyId,
  issueUrl,
  apiUrl,
  escrowedByToken,
  isFunder,
  onPayouted,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  walletAddress: Address | null;
  onWalletConnect?: () => Promise<unknown> | void;
  githubUser: GithubUser | null;
  onGithubLogin: () => void;
  bountyId: string | null;
  issueUrl?: string | null;
  apiUrl: string;
  escrowedByToken?: Record<string, string>;
  isFunder: boolean;
  onPayouted?: () => void;
}) {
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "31337");
  const usdcAddress = usdcAddressForChainId(chainId);

  const [mode, setMode] = React.useState<Mode>("repo");
  const [repoAsset, setRepoAsset] = React.useState<AssetChoiceRepo>("ALL");
  const [funderAsset, setFunderAsset] = React.useState<AssetChoiceFunder>("ETH");
  const [recipient, setRecipient] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [autoAmount, setAutoAmount] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [onchainTotalsByToken, setOnchainTotalsByToken] = React.useState<Record<string, { escrowed: string; funded: string; paid: string }> | null>(
    null
  );
  const [onchainContributionByToken, setOnchainContributionByToken] = React.useState<Record<string, { amount: string; lockedUntil: number }> | null>(
    null
  );

  const escrowedEth = escrowedByToken?.[ETH_ADDRESS.toLowerCase()] || "0";
  const escrowedUsdc = usdcAddress ? escrowedByToken?.[usdcAddress.toLowerCase()] || "0" : "0";

  // Prefer on-chain totals (source of truth) when available; fall back to indexed DB totals.
  const escrowedEthEffective = onchainTotalsByToken?.[ETH_ADDRESS.toLowerCase()]?.escrowed ?? escrowedEth;
  const escrowedUsdcEffective = usdcAddress ? (onchainTotalsByToken?.[usdcAddress.toLowerCase()]?.escrowed ?? escrowedUsdc) : "0";

  const maxForRepoAsset = React.useMemo(() => {
    if (repoAsset === "ETH") return { raw: escrowedEthEffective, decimals: 18 };
    if (repoAsset === "USDC") return { raw: escrowedUsdcEffective, decimals: 6 };
    return { raw: "0", decimals: 6 };
  }, [repoAsset, escrowedEthEffective, escrowedUsdcEffective]);

  const maxRepoDisplay = React.useMemo(() => {
    try {
      return formatUnits(BigInt(maxForRepoAsset.raw || "0"), maxForRepoAsset.decimals);
    } catch {
      return "0";
    }
  }, [maxForRepoAsset]);

  React.useEffect(() => {
    if (!open) return;
    setMode("repo");
    setRepoAsset("ALL");
    setFunderAsset("ETH");
    setRecipient(walletAddress || "");
    setAmount("");
    setAutoAmount(true);
    setError(null);
    setOnchainTotalsByToken(null);
    setOnchainContributionByToken(null);
  }, [open, walletAddress]);

  React.useEffect(() => {
    if (!open) return;
    if (!bountyId) return;

    let active = true;
    const { contractAddress } = getConfig();
    const pc = getPublicClient();

    const tokens = [ETH_ADDRESS.toLowerCase(), usdcAddress?.toLowerCase()].filter(Boolean) as string[];

    (async () => {
      try {
        const totals = await Promise.all(
          tokens.map(async (t) => {
            const res = (await pc.readContract({
              address: contractAddress,
              abi: ghBountiesAbi,
              functionName: "getTotals",
              args: [bountyId as Hex, t as Address],
            })) as readonly [bigint, bigint, bigint];
            return { token: t, escrowed: res[0].toString(), funded: res[1].toString(), paid: res[2].toString() };
          })
        );
        if (!active) return;
        const map: Record<string, { escrowed: string; funded: string; paid: string }> = {};
        for (const t of totals) map[t.token] = { escrowed: t.escrowed, funded: t.funded, paid: t.paid };
        setOnchainTotalsByToken(map);
      } catch {
        // Best-effort: keep UI functional even if RPC is temporarily unavailable.
        if (!active) return;
        setOnchainTotalsByToken(null);
      }

      if (!walletAddress) return;
      try {
        const contributions = await Promise.all(
          tokens.map(async (t) => {
            const res = (await pc.readContract({
              address: contractAddress,
              abi: ghBountiesAbi,
              functionName: "getContribution",
              args: [bountyId as Hex, t as Address, walletAddress],
            })) as readonly [bigint, bigint];
            return { token: t, amount: res[0].toString(), lockedUntil: Number(res[1] ?? 0n) };
          })
        );
        if (!active) return;
        const map: Record<string, { amount: string; lockedUntil: number }> = {};
        for (const c of contributions) map[c.token] = { amount: c.amount, lockedUntil: c.lockedUntil };
        setOnchainContributionByToken(map);
      } catch {
        if (!active) return;
        setOnchainContributionByToken(null);
      }
    })();

    return () => {
      active = false;
    };
  }, [open, bountyId, walletAddress, usdcAddress]);

  React.useEffect(() => {
    if (!open) return;
    if (mode !== "repo") return;
    if (repoAsset === "ALL") {
      setAmount("");
      return;
    }
    if (!autoAmount) return;
    setAmount(maxRepoDisplay);
  }, [open, mode, repoAsset, maxRepoDisplay, autoAmount]);

  React.useEffect(() => {
    if (!open) return;
    // Avoid carrying an auto-filled repo payout amount into funder payout mode.
    if (mode === "funder") {
      setAutoAmount(false);
      setAmount("");
    } else {
      setAutoAmount(true);
    }
  }, [open, mode]);

  const canSubmitRepo = Boolean(walletAddress && bountyId && isAddress(recipient.trim()) && githubUser);
  const canSubmitFunder = Boolean(walletAddress && bountyId && isAddress(recipient.trim()) && amount && Number(amount) > 0 && isFunder);

  async function submitRepoPayout(opts: { token: Address; amountWei: bigint }) {
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
      args: [bountyId as Hex, opts.token, recipient.trim() as Address, opts.amountWei, nonce, deadline, signature],
      account,
    });
    await pc.waitForTransactionReceipt({ hash });
  }

  async function submit() {
    if (!bountyId) {
      setError("Missing bounty id.");
      return;
    }
    if (!recipient.trim() || !isAddress(recipient.trim())) {
      setError("Enter a valid recipient address.");
      return;
    }
    if (mode === "repo" && !githubUser) {
      setError("Connect GitHub (repo admin) to approve payouts.");
      return;
    }
    if (!walletAddress) {
      setError("Connect a wallet to pay out.");
      return;
    }
    if (mode === "funder") {
      if (!isFunder) {
        setError("Only bounty funders can use funder payout.");
        return;
      }
      if (!amount || Number(amount) <= 0) {
        setError("Enter a valid amount.");
        return;
      }
      if (funderAsset === "USDC" && !usdcAddress) {
        setError("USDC is not configured for this chain.");
        return;
      }
    } else {
      if (repoAsset !== "ALL" && (!amount || Number(amount) <= 0)) {
        setError("Enter a valid amount.");
        return;
      }
      if (repoAsset === "USDC" && !usdcAddress) {
        setError("USDC is not configured for this chain.");
        return;
      }
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const { contractAddress } = getConfig();
      await ensureWalletChain(chainId);
      const wc = getWalletClient();
      const [account] = await wc.getAddresses();
      const pc = getPublicClient();

      if (mode === "repo") {
        let didSubmit = false;
        if (repoAsset === "ALL" || repoAsset === "ETH") {
          const amountWei = repoAsset === "ALL" ? BigInt(escrowedEthEffective || "0") : parseEther(amount);
          if (amountWei > 0n) {
            await submitRepoPayout({ token: ETH_ADDRESS, amountWei });
            didSubmit = true;
          }
        }
        if (repoAsset === "ALL" || repoAsset === "USDC") {
          if (!usdcAddress) throw new Error("USDC is not configured for this chain.");
          const amountWei = repoAsset === "ALL" ? BigInt(escrowedUsdcEffective || "0") : parseUnits(amount, 6);
          if (amountWei > 0n) {
            await submitRepoPayout({ token: usdcAddress as Address, amountWei });
            didSubmit = true;
          }
        }
        if (!didSubmit) throw new Error("No payoutable balance available for the selected asset.");
      } else {
        const token = funderAsset === "ETH" ? ETH_ADDRESS : (usdcAddress as Address);
        const decimals = funderAsset === "ETH" ? 18 : 6;
        const amountWei = funderAsset === "ETH" ? parseEther(amount) : parseUnits(amount, decimals);

        // Preflight against on-chain constraints to avoid spending gas on a revert.
        const [contributedAmountRaw] = (await pc.readContract({
          address: contractAddress,
          abi: ghBountiesAbi,
          functionName: "getContribution",
          args: [bountyId as Hex, token as Address, account],
        })) as readonly [bigint, bigint];
        const [escrowedChainRaw] = (await pc.readContract({
          address: contractAddress,
          abi: ghBountiesAbi,
          functionName: "getTotals",
          args: [bountyId as Hex, token as Address],
        })) as readonly [bigint, bigint, bigint];
        if (amountWei > contributedAmountRaw) {
          throw new Error(`Amount exceeds your contribution (max ${formatUnits(contributedAmountRaw, decimals)}).`);
        }
        if (amountWei > escrowedChainRaw) {
          throw new Error(`Amount exceeds bounty escrow (max ${formatUnits(escrowedChainRaw, decimals)}).`);
        }

        const hash = await wc.writeContract({
          address: contractAddress,
          abi: ghBountiesAbi,
          functionName: "funderPayout",
          args: [bountyId as Hex, token as Address, recipient.trim() as Address, amountWei],
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

  const canSubmit = mode === "repo" ? canSubmitRepo : canSubmitFunder;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pay out bounty</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          {issueUrl ? <div className="text-xs text-muted-foreground">Issue: {issueUrl}</div> : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === "repo" ? "secondary" : "outline"}
              onClick={() => setMode("repo")}
            >
              Repo owner payout
            </Button>
            {isFunder ? (
              <Button
                type="button"
                size="sm"
                variant={mode === "funder" ? "secondary" : "outline"}
                onClick={() => setMode("funder")}
              >
                Funder payout
              </Button>
            ) : null}
          </div>

          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <span>Wallet: {walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : "Not connected"}</span>
            {!walletAddress && onWalletConnect ? (
              <Button size="sm" variant="outline" onClick={() => onWalletConnect()}>
                Connect wallet
              </Button>
            ) : null}
          </div>

          {mode === "repo" ? (
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <span>GitHub: {githubUser ? `@${githubUser.login}` : "Not connected"}</span>
              {!githubUser ? (
                <Button size="sm" variant="outline" onClick={onGithubLogin}>
                  Connect GitHub
                </Button>
              ) : null}
            </div>
          ) : null}

          {mode === "repo" ? (
            <div className="grid gap-2">
              <Label>Asset</Label>
              <Select
                value={repoAsset}
                onValueChange={(value) => {
                  setRepoAsset(value as AssetChoiceRepo);
                  setAutoAmount(true);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select asset" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All assets</SelectItem>
                  <SelectItem value="ETH">ETH (escrow)</SelectItem>
                  {usdcAddress ? <SelectItem value="USDC">USDC (escrow)</SelectItem> : null}
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground">
                {repoAsset === "ALL" ? (
                  <>
                    ETH: {formatUnits(BigInt(escrowedEthEffective || "0"), 18)}
                    {usdcAddress ? ` • USDC: ${formatUnits(BigInt(escrowedUsdcEffective || "0"), 6)}` : null}
                  </>
                ) : (
                  `Max: ${maxRepoDisplay}`
                )}
              </div>
            </div>
          ) : (
            <div className="grid gap-2">
              <Label>Asset</Label>
              <Select value={funderAsset} onValueChange={(value) => setFunderAsset(value as AssetChoiceFunder)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select asset" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ETH">ETH</SelectItem>
                  {usdcAddress ? <SelectItem value="USDC">USDC</SelectItem> : null}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="recipient">Recipient</Label>
            <Input
              id="recipient"
              placeholder="0x..."
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
            />
          </div>

          {mode === "repo" ? (
            repoAsset === "ALL" ? null : (
              <div className="grid gap-2">
                <Label htmlFor="amount">Amount</Label>
                <Input
                  id="amount"
                  placeholder="0.01"
                  value={amount}
                  onChange={(event) => {
                    setAutoAmount(false);
                    setAmount(event.target.value);
                  }}
                />
              </div>
            )
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="amount">Amount</Label>
              <Input
                id="amount"
                placeholder="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              {(() => {
                const token = funderAsset === "ETH" ? ETH_ADDRESS.toLowerCase() : usdcAddress?.toLowerCase();
                if (!token) return null;
                const contrib = onchainContributionByToken?.[token];
                if (!contrib) return null;
                const decimals = funderAsset === "ETH" ? 18 : 6;
                return (
                  <div className="text-xs text-muted-foreground">
                    Max (your contribution): {formatUnits(BigInt(contrib.amount || "0"), decimals)}
                  </div>
                );
              })()}
              {!isFunder ? <div className="text-xs text-muted-foreground">Only funders can use funder payout.</div> : null}
            </div>
          )}

          {error ? <div className="text-sm text-destructive">{error}</div> : null}
        </div>

        <DialogFooter>
          <Button
            onClick={() => submit()}
            disabled={!canSubmit || isSubmitting}
          >
            {isSubmitting ? "Submitting..." : "Submit payout"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
