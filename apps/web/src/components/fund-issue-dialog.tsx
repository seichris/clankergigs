"use client";

import * as React from "react";
import { createPublicClient, createWalletClient, custom, defineChain, formatUnits, isAddress, parseEther, parseUnits, type Address } from "viem";
import { bountyId as computeBountyId, repoHash as computeRepoHash, usdcAddressForChainId } from "@gh-bounties/shared";

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { erc20Abi, gatewayWalletAbi, ghBountiesAbi } from "@/lib/abi";
import { parseGithubIssueUrl } from "@/lib/gh";
import { ensureWalletChain, getConfig, getPublicClient, getWalletClient } from "@/lib/wallet";

type DerivedIssue = {
  issueUrl: string;
  repoId: string;
  issueNumber: number;
  repoHash: `0x${string}`;
  bountyId: `0x${string}`;
};

export function FundIssueDialog({
  open,
  onOpenChange,
  walletAddress,
  defaultIssueUrl,
  onFunded,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  walletAddress: Address | null;
  defaultIssueUrl?: string | null;
  onFunded?: () => void;
}) {
  const [issueUrl, setIssueUrl] = React.useState(defaultIssueUrl || "");
  const [asset, setAsset] = React.useState<"ETH" | "USDC" | "USDC_GLOBAL">("ETH");
  const [lockDays, setLockDays] = React.useState("7");
  const [amount, setAmount] = React.useState("0.01");
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [treasuryConfig, setTreasuryConfig] = React.useState<any | null>(null);
  const [sourceChainId, setSourceChainId] = React.useState<string>("11155111");

  React.useEffect(() => {
    if (open) {
      setIssueUrl(defaultIssueUrl || "");
      setError(null);
      setTreasuryConfig(null);
    }
  }, [open, defaultIssueUrl]);

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "31337");
  const usdcAddress = usdcAddressForChainId(chainId);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787";

  React.useEffect(() => {
    if (!open) return;
    fetch(`${apiUrl}/treasury/config`)
      .then((r) => r.json())
      .then((json) => {
        setTreasuryConfig(json);
        const first = json?.gateway?.supportedSources?.[0]?.chainId;
        if (first) setSourceChainId(String(first));
      })
      .catch(() => setTreasuryConfig({ enabled: false }));
  }, [open, apiUrl]);

  const derived = React.useMemo<DerivedIssue | null>(() => {
    try {
      const parsed = parseGithubIssueUrl(issueUrl);
      const repoHash = computeRepoHash(parsed.repoId);
      const bountyId = computeBountyId(repoHash, BigInt(parsed.issueNumber));
      return {
        issueUrl,
        repoId: parsed.repoId,
        issueNumber: parsed.issueNumber,
        repoHash,
        bountyId,
      };
    } catch {
      return null;
    }
  }, [issueUrl]);

  const lockDaysValue = Number.isFinite(Number(lockDays)) ? Number(lockDays) : 0;
  const amountValue = Number(amount);
  const canSubmit = Boolean(
    walletAddress &&
      derived &&
      amountValue > 0 &&
      (asset === "ETH" || (asset === "USDC" && usdcAddress) || asset === "USDC_GLOBAL")
  );

  async function ensureBountyExists() {
    if (!derived) throw new Error("Invalid issue URL");
    const { contractAddress } = getConfig();
    await ensureWalletChain(chainId);
    const pc = getPublicClient();
    const wc = getWalletClient();

    const bounty = (await pc.readContract({
      address: contractAddress,
      abi: ghBountiesAbi,
      functionName: "bounties",
      args: [derived.bountyId],
    })) as readonly [string, bigint, number, bigint, string];

    const createdAt = BigInt(bounty[3] ?? BigInt(0));
    if (createdAt !== BigInt(0)) return;

    const [account] = await wc.getAddresses();
    const hash = await wc.writeContract({
      address: contractAddress,
      abi: ghBountiesAbi,
      functionName: "createBounty",
      args: [derived.repoHash, BigInt(derived.issueNumber), issueUrl],
      account,
    });
    await pc.waitForTransactionReceipt({ hash });
  }

  async function submit() {
    if (!walletAddress) return;
    if (!derived) {
      setError("Enter a valid GitHub issue URL.");
      return;
    }
    if (!amount || amountValue <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    if (asset === "USDC" && !usdcAddress) {
      setError("USDC is not configured for this chain.");
      return;
    }
    if (asset === "USDC_GLOBAL" && !treasuryConfig?.enabled) {
      setError("Treasury is not enabled on the API.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const { contractAddress } = getConfig();
      if (asset !== "USDC_GLOBAL") {
        await ensureWalletChain(chainId);
      }
      const wc = getWalletClient();
      const [account] = await wc.getAddresses();
      const pc = getPublicClient();

      await ensureBountyExists();

      const lockSeconds = Math.max(0, Math.floor(lockDaysValue * 24 * 60 * 60));

      if (asset === "ETH") {
        const hash = await wc.writeContract({
          address: contractAddress,
          abi: ghBountiesAbi,
          functionName: "fundBountyETH",
          args: [derived.bountyId, BigInt(lockSeconds)],
          value: parseEther(amount),
          account,
        });
        await pc.waitForTransactionReceipt({ hash });
      } else if (asset === "USDC") {
        const token = (usdcAddress || "").trim();
        if (!isAddress(token)) throw new Error("Invalid USDC address");
        const decimals = 6;
        const amountWei = parseUnits(amount, decimals);

        const approveTx = await wc.writeContract({
          address: token as Address,
          abi: erc20Abi,
          functionName: "approve",
          args: [contractAddress, amountWei],
          account,
        });
        await pc.waitForTransactionReceipt({ hash: approveTx });

        const fundTx = await wc.writeContract({
          address: contractAddress,
          abi: ghBountiesAbi,
          functionName: "fundBountyToken",
          args: [derived.bountyId, token as Address, amountWei, BigInt(lockSeconds)],
          account,
        });
        await pc.waitForTransactionReceipt({ hash: fundTx });
      } else {
        const srcId = Number(sourceChainId);
        if (!Number.isFinite(srcId) || srcId <= 0) throw new Error("Invalid source chain");
        const amountUsdc = amount;

        const res = await fetch(`${apiUrl}/treasury/funding-intents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bountyId: derived.bountyId,
            amountUsdc,
            sourceChainId: srcId,
            sender: walletAddress,
          }),
        });
        const json = (await res.json()) as any;
        if (!res.ok) throw new Error(json?.error ?? `Failed to create funding intent (${res.status})`);

        const { intentId, deposit, burnIntent, typedData } = json;
        const gatewayWalletContract = deposit?.gatewayWalletContract as Address;
        const token = deposit?.usdcAddress as Address;

        const eth = (globalThis as any).ethereum;
        if (!eth) throw new Error("No injected wallet found (window.ethereum)");

        const initialChainHex = await eth.request({ method: "eth_chainId" }).catch(() => null);
        const initialChainId =
          typeof initialChainHex === "string" ? Number.parseInt(initialChainHex, 16) : null;

        try {
          await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${srcId.toString(16)}` }] });
        } catch {
          // user can switch manually; proceed and let tx fail if wrong chain
        }

        const srcChain = defineChain({
          id: srcId,
          name: `Chain ${srcId}`,
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: [""] } },
        });
        const srcWc = createWalletClient({ chain: srcChain, transport: custom(eth) });
        const srcPc = createPublicClient({ chain: srcChain, transport: custom(eth) });
        const [srcAccount] = await srcWc.getAddresses();

        const amountWei = parseUnits(amountUsdc, 6);
        const approveTx = await srcWc.writeContract({
          address: token,
          abi: erc20Abi,
          functionName: "approve",
          args: [gatewayWalletContract, amountWei],
          account: srcAccount,
        });
        await srcPc.waitForTransactionReceipt({ hash: approveTx });

        const depositTx = await srcWc.writeContract({
          address: gatewayWalletContract,
          abi: gatewayWalletAbi,
          functionName: "deposit",
          args: [token, amountWei],
          account: srcAccount,
        });
        await srcPc.waitForTransactionReceipt({ hash: depositTx });

        const burnForSign = {
          ...burnIntent,
          maxBlockHeight: BigInt(burnIntent.maxBlockHeight),
          maxFee: BigInt(burnIntent.maxFee),
          spec: {
            ...burnIntent.spec,
            version: Number(burnIntent.spec.version),
            sourceDomain: Number(burnIntent.spec.sourceDomain),
            destinationDomain: Number(burnIntent.spec.destinationDomain),
            value: BigInt(burnIntent.spec.value),
          },
        };

        const signature = await srcWc.signTypedData({
          account: srcAccount,
          domain: typedData.domain,
          types: typedData.types,
          primaryType: typedData.primaryType,
          message: burnForSign,
        } as any);

        const sigRes = await fetch(`${apiUrl}/treasury/funding-intents/${intentId}/submit-signature`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signature }),
        });
        const sigJson = (await sigRes.json()) as any;
        if (!sigRes.ok) throw new Error(sigJson?.error ?? `Failed to submit signature (${sigRes.status})`);

        const mintRes = await fetch(`${apiUrl}/treasury/funding-intents/${intentId}/mint`, { method: "POST" });
        const mintJson = (await mintRes.json()) as any;
        if (!mintRes.ok) throw new Error(mintJson?.error ?? `Failed to mint on Arc (${mintRes.status})`);

        if (initialChainId && initialChainId !== srcId) {
          try {
            await eth.request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: `0x${initialChainId.toString(16)}` }],
            });
          } catch {
            // ignore
          }
        }
      }

      onOpenChange(false);
      onFunded?.();
    } catch (err: any) {
      setError(err?.shortMessage ?? err?.message ?? String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  const previewLine = derived
    ? `repo: ${derived.repoId} • issue: #${derived.issueNumber}`
    : "Enter a GitHub issue URL";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fund Issue</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="issue-url">GitHub issue URL</Label>
            <Input
              id="issue-url"
              value={issueUrl}
              onChange={(event) => setIssueUrl(event.target.value)}
              placeholder="https://github.com/org/repo/issues/1"
            />
            <div className="text-xs text-muted-foreground">{previewLine}</div>
          </div>

          {/* <div className="grid gap-2">
            <Label>Repo hash</Label>
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs font-mono text-muted-foreground">
              {derived ? derived.repoHash : "-"}
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Bounty ID</Label>
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs font-mono text-muted-foreground">
              {derived ? derived.bountyId : "-"}
            </div>
          </div> */}

          <div className="grid gap-2">
            <Label>Funding asset</Label>
            <Select value={asset} onValueChange={(value) => setAsset(value as any)}>
              <SelectTrigger>
                <SelectValue placeholder="Select asset" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ETH">ETH</SelectItem>
                <SelectItem value="USDC">ERC20 (USDC)</SelectItem>
                <SelectItem value="USDC_GLOBAL">USDC (Global via Gateway)</SelectItem>
              </SelectContent>
            </Select>
            {asset === "USDC" && !usdcAddress ? (
              <div className="text-xs text-amber-600">USDC is not configured for chain {chainId}.</div>
            ) : null}
            {asset === "USDC_GLOBAL" && !treasuryConfig?.enabled ? (
              <div className="text-xs text-amber-600">Treasury is disabled on the API.</div>
            ) : null}
          </div>

          {asset === "USDC_GLOBAL" && treasuryConfig?.enabled ? (
            <div className="grid gap-2">
              <Label>Source chain (USDC deposit)</Label>
              <Select value={sourceChainId} onValueChange={setSourceChainId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select source chain" />
                </SelectTrigger>
                <SelectContent>
                  {(treasuryConfig?.gateway?.supportedSources ?? []).map((c: any) => (
                    <SelectItem key={String(c.chainId)} value={String(c.chainId)}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground">
                This flow deposits USDC into Circle Gateway on the selected chain, then mints USDC into the Arc treasury.
              </div>
            </div>
          ) : null}

          {asset === "USDC_GLOBAL" ? (
            <div className="grid gap-2">
              <Label htmlFor="amount">Amount (USDC)</Label>
              <Input id="amount" value={amount} onChange={(event) => setAmount(event.target.value)} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="lock-days">Lock days</Label>
                <Input id="lock-days" value={lockDays} onChange={(event) => setLockDays(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="amount">Amount</Label>
                <Input id="amount" value={amount} onChange={(event) => setAmount(event.target.value)} />
              </div>
            </div>
          )}

          {asset === "USDC" && usdcAddress ? (
            <div className="text-xs text-muted-foreground">
              USDC address: {usdcAddress} (6 decimals, example: {formatUnits(1000000n, 6)} = 1 USDC)
            </div>
          ) : null}

          {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{error}</div> : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isSubmitting || !canSubmit}>
            {isSubmitting ? "Funding..." : "Fund Issue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
