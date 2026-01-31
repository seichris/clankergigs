"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits, isAddress, parseEther, parseUnits, type Address } from "viem";
import { bountyId as computeBountyId, repoHash as computeRepoHash, usdcAddressForChainId } from "@gh-bounties/shared";
import { erc20Abi, ghBountiesAbi } from "@/lib/abi";
import { parseGithubIssueUrl } from "@/lib/gh";
import { getConfig, getPublicClient, getWalletClient, requestAccounts } from "@/lib/wallet";

export default function Home() {
  const [wallet, setWallet] = useState<Address | null>(null);
  const [issueUrl, setIssueUrl] = useState("https://github.com/seichris/gh-bounties/issues/1");
  const [prUrl, setPrUrl] = useState("https://github.com/seichris/gh-bounties/pull/3");
  const [asset, setAsset] = useState<"ETH" | "TOKEN">("ETH");
  const [tokenAddress, setTokenAddress] = useState("");
  const [fundAmount, setFundAmount] = useState("0.01");
  const [lockDays, setLockDays] = useState("7");
  const [payoutRecipient, setPayoutRecipient] = useState("");
  const [payoutAmount, setPayoutAmount] = useState("0.01");
  const [claims, setClaims] = useState<Array<{ claimId: number; claimer: string; metadataURI: string }>>([]);
  const [claimerShares, setClaimerShares] = useState<Record<string, number>>({});
  const [totals, setTotals] = useState<{
    escrowed: bigint;
    funded: bigint;
    paid: bigint;
    decimals: number;
    token: Address;
  } | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [walletWarning, setWalletWarning] = useState<string | null>(null);

  const parsed = useMemo(() => {
    try {
      return parseGithubIssueUrl(issueUrl);
    } catch {
      return null;
    }
  }, [issueUrl]);

  const claimers = useMemo(() => {
    const uniq = new Set<string>();
    for (const c of claims) uniq.add(c.claimer);
    return Array.from(uniq);
  }, [claims]);

  const payoutSplits = useMemo(() => {
    if (claimers.length === 0) return [];
    const total = totals?.escrowed ?? 0n;
    const totalShare = claimers.reduce((sum, addr) => sum + (claimerShares[addr] ?? 0), 0);
    if (!totals || totalShare <= 0) {
      return claimers.map((claimer) => ({ claimer, share: claimerShares[claimer] ?? 0, amount: null as bigint | null }));
    }

    const denom = BigInt(totalShare);
    const rows = claimers.map((claimer) => ({
      claimer,
      share: claimerShares[claimer] ?? 0,
      amount: (total * BigInt(claimerShares[claimer] ?? 0)) / denom
    }));

    let allocated = rows.reduce((sum, row) => sum + (row.amount ?? 0n), 0n);
    let remainder = total - allocated;
    if (remainder > 0n) {
      for (const row of rows) {
        if (remainder === 0n) break;
        if (row.share <= 0) continue;
        row.amount = (row.amount ?? 0n) + 1n;
        remainder -= 1n;
      }
    }

    return rows;
  }, [claimers, claimerShares, totals]);

  const derived = useMemo(() => {
    if (!parsed) return null;
    const rh = computeRepoHash(parsed.repoId);
    const bid = computeBountyId(rh, BigInt(parsed.issueNumber));
    return { repoHash: rh, bountyId: bid };
  }, [parsed]);

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "31337");

  const token = useMemo(() => {
    if (asset === "ETH") return "0x0000000000000000000000000000000000000000";
    return tokenAddress.trim();
  }, [asset, tokenAddress]);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8787";
  const txDisabled = !wallet;

  function pushLog(message: string) {
    setLog((prev) => [...prev, message]);
  }

  function splitPayouts(total: bigint, shares: Record<string, number>, order: string[]) {
    const totalShare = order.reduce((sum, addr) => sum + (shares[addr] ?? 0), 0);
    if (total <= 0n || totalShare <= 0) return [];
    const denom = BigInt(totalShare);
    const payouts = order.map((addr) => ({
      recipient: addr,
      share: shares[addr] ?? 0,
      amount: (total * BigInt(shares[addr] ?? 0)) / denom
    }));
    let allocated = payouts.reduce((sum, p) => sum + p.amount, 0n);
    let remainder = total - allocated;
    if (remainder > 0n) {
      for (const p of payouts) {
        if (remainder === 0n) break;
        if (p.share <= 0) continue;
        p.amount += 1n;
        remainder -= 1n;
      }
    }
    return payouts.filter((p) => p.amount > 0n);
  }

  function updateShare(target: string, value: number) {
    setClaimerShares((prev) => {
      if (claimers.length === 0) return prev;
      const clamped = Math.max(0, Math.min(100, Math.round(value)));
      const next: Record<string, number> = { ...prev, [target]: clamped };
      const others = claimers.filter((claimer) => claimer !== target);
      if (others.length === 0) {
        next[target] = 100;
        return next;
      }

      const remaining = 100 - clamped;
      const prevOtherTotal = others.reduce((sum, claimer) => sum + (prev[claimer] ?? 0), 0);
      if (prevOtherTotal <= 0) {
        const base = Math.floor(remaining / others.length);
        let remainder = remaining - base * others.length;
        for (const claimer of others) {
          next[claimer] = base + (remainder > 0 ? 1 : 0);
          remainder = Math.max(0, remainder - 1);
        }
        return next;
      }

      let allocated = 0;
      for (const claimer of others) {
        const share = Math.floor(((prev[claimer] ?? 0) / prevOtherTotal) * remaining);
        next[claimer] = share;
        allocated += share;
      }
      let remainder = remaining - allocated;
      for (const claimer of others) {
        if (remainder <= 0) break;
        next[claimer] = (next[claimer] ?? 0) + 1;
        remainder -= 1;
      }
      return next;
    });
  }

  // Small UX helper: when switching to TOKEN, auto-fill USDC for known chains if empty.
  useEffect(() => {
    if (asset !== "TOKEN") return;
    if (tokenAddress.trim().length > 0) return;
    const addr = usdcAddressForChainId(chainId);
    if (addr) setTokenAddress(addr);
  }, [asset, chainId, tokenAddress]);

  useEffect(() => {
    if (claimers.length === 0) {
      setClaimerShares({});
      return;
    }
    setClaimerShares((prev) => {
      const prevKeys = Object.keys(prev);
      const same =
        prevKeys.length === claimers.length && claimers.every((claimer) => prev[claimer] !== undefined);
      if (same) return prev;

      const base = Math.floor(100 / claimers.length);
      let remainder = 100 - base * claimers.length;
      const next: Record<string, number> = {};
      for (const claimer of claimers) {
        next[claimer] = base + (remainder > 0 ? 1 : 0);
        remainder = Math.max(0, remainder - 1);
      }
      return next;
    });
  }, [claimers]);

  // Warn if wallet network or RPC doesn't match app config.
  useEffect(() => {
    let cancelled = false;
    const eth = (globalThis as any).ethereum;
    if (!eth) {
      setWalletWarning(null);
      return;
    }

    async function checkWalletNetwork() {
      try {
        const chainHex = (await eth.request({ method: "eth_chainId" })) as string;
        const walletChainId = Number(chainHex);
        if (walletChainId !== chainId) {
          if (!cancelled) {
            setWalletWarning(`Wallet chainId ${walletChainId} does not match app chainId ${chainId}.`);
          }
          return;
        }

        try {
          const [walletBlockHex, appBlock] = await Promise.all([
            eth.request({ method: "eth_blockNumber" }),
            getPublicClient().getBlockNumber()
          ]);
          const walletBlock = BigInt(walletBlockHex);
          const diff = walletBlock > appBlock ? walletBlock - appBlock : appBlock - walletBlock;
          if (diff > 5n) {
            if (!cancelled) {
              setWalletWarning(
                `Wallet RPC looks out of sync with app RPC (wallet block ${walletBlock} vs app block ${appBlock}).`
              );
            }
            return;
          }
        } catch {
          // If block comparison fails, keep the chainId check as the primary signal.
        }

        if (!cancelled) setWalletWarning(null);
      } catch {
        if (!cancelled) setWalletWarning(null);
      }
    }

    checkWalletNetwork();

    if (eth?.on) {
      const handler = () => checkWalletNetwork();
      eth.on("chainChanged", handler);
      eth.on("connect", handler);
      return () => {
        cancelled = true;
        eth.removeListener?.("chainChanged", handler);
        eth.removeListener?.("connect", handler);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [chainId, wallet]);

  useEffect(() => {
    if (!derived) {
      setTotals(null);
      return;
    }
    fetchTotals().catch(() => {
      // Best-effort; errors logged via explicit refresh.
    });
  }, [derived, asset, tokenAddress]);

  async function fetchTotals() {
    if (!derived) return null;
    const { contractAddress } = getConfig();
    const pc = getPublicClient();
    const t = asset === "ETH" ? ("0x0000000000000000000000000000000000000000" as Address) : (tokenAddress.trim() as Address);
    if (asset !== "ETH" && !isAddress(t)) {
      setTotals(null);
      throw new Error("Invalid token address");
    }

    const res = (await pc.readContract({
      address: contractAddress,
      abi: ghBountiesAbi,
      functionName: "getTotals",
      args: [derived.bountyId, t]
    })) as readonly [bigint, bigint, bigint];

    let decimals = 18;
    if (asset !== "ETH") {
      try {
        decimals = Number(
          (await pc.readContract({
            address: t,
            abi: erc20Abi,
            functionName: "decimals"
          })) as any
        );
      } catch {
        decimals = 6;
      }
    }

    const nextTotals = { escrowed: res[0], funded: res[1], paid: res[2], decimals, token: t };
    setTotals(nextTotals);
    return nextTotals;
  }

  async function ensureBountyExists() {
    if (!derived || !parsed) return;
    const { contractAddress } = getConfig();
    const pc = getPublicClient();
    const wc = getWalletClient();

    const repo = (await pc.readContract({
      address: contractAddress,
      abi: ghBountiesAbi,
      functionName: "repos",
      args: [derived.repoHash]
    })) as readonly [Address, boolean];

    if (!repo[1]) {
      throw new Error("Repo not registered. Register repo first.");
    }

    const bounty = (await pc.readContract({
      address: contractAddress,
      abi: ghBountiesAbi,
      functionName: "bounties",
      args: [derived.bountyId]
    })) as readonly [string, bigint, number, bigint, string];

    const createdAt = BigInt(bounty[3] ?? 0n);
    if (createdAt !== 0n) return;

    const [account] = await wc.getAddresses();
    const hash = await wc.writeContract({
      address: contractAddress,
      abi: ghBountiesAbi,
      functionName: "createBounty",
      args: [derived.repoHash, BigInt(parsed.issueNumber), issueUrl],
      account
    });
    pushLog(`createBounty tx: ${hash}`);
    await pc.waitForTransactionReceipt({ hash });
  }

  async function connect() {
    try {
      const addr = await requestAccounts();
      setWallet(addr);
      pushLog(`connected: ${addr}`);
    } catch (e: any) {
      pushLog(e?.message ?? String(e));
    }
  }

  async function registerRepo() {
    if (!derived) return;
    try {
      const { contractAddress } = getConfig();
      const wc = getWalletClient();
      const [account] = await wc.getAddresses();

      const hash = await wc.writeContract({
        address: contractAddress,
        abi: ghBountiesAbi,
        functionName: "registerRepo",
        args: [derived.repoHash],
        account
      });
      pushLog(`registerRepo tx: ${hash}`);
    } catch (e: any) {
      pushLog(e?.shortMessage ?? e?.message ?? String(e));
    }
  }

  async function fundBounty() {
    if (!derived || !parsed) return;
    try {
      const { contractAddress } = getConfig();
      const wc = getWalletClient();
      const [account] = await wc.getAddresses();

      await ensureBountyExists();

      const lockSeconds = Math.max(0, Math.floor(Number(lockDays) * 24 * 60 * 60));

      if (asset === "ETH") {
        const hash = await wc.writeContract({
          address: contractAddress,
          abi: ghBountiesAbi,
          functionName: "fundBountyETH",
          args: [derived.bountyId, BigInt(lockSeconds)],
          value: parseEther(fundAmount),
          account
        });
        pushLog(`fundBountyETH tx: ${hash}`);
      } else {
        const t = tokenAddress.trim();
        if (!isAddress(t)) throw new Error("Invalid token address");

        const pc = getPublicClient();
        let decimals = 6;
        try {
          decimals = Number(
            (await pc.readContract({
              address: t as Address,
              abi: erc20Abi,
              functionName: "decimals"
            })) as any
          );
        } catch {
          // Default to 6 (USDC) if token doesn't implement decimals() cleanly.
          decimals = 6;
        }

        const amount = parseUnits(fundAmount, decimals);

        // Approve exact amount each time for MVP.
        const approveTx = await wc.writeContract({
          address: t as Address,
          abi: erc20Abi,
          functionName: "approve",
          args: [contractAddress, amount],
          account
        });
        pushLog(`approve tx: ${approveTx}`);

        const fundTx = await wc.writeContract({
          address: contractAddress,
          abi: ghBountiesAbi,
          functionName: "fundBountyToken",
          args: [derived.bountyId, t as Address, amount, BigInt(lockSeconds)],
          account
        });
        pushLog(`fundBountyToken tx: ${fundTx}`);
      }
    } catch (e: any) {
      pushLog(e?.shortMessage ?? e?.message ?? String(e));
    }
  }

  async function submitClaim() {
    if (!derived) return;
    try {
      const { contractAddress } = getConfig();
      const wc = getWalletClient();
      const [account] = await wc.getAddresses();

      const hash = await wc.writeContract({
        address: contractAddress,
        abi: ghBountiesAbi,
        functionName: "submitClaim",
        args: [derived.bountyId, prUrl],
        account
      });
      pushLog(`submitClaim tx: ${hash}`);
    } catch (e: any) {
      pushLog(e?.shortMessage ?? e?.message ?? String(e));
    }
  }

  async function payout() {
    if (!derived) return;
    try {
      const recipient = payoutRecipient.trim();
      const { contractAddress } = getConfig();
      const wc = getWalletClient();
      const [account] = await wc.getAddresses();

      if (claimers.length > 1) {
        const currentTotals = await fetchTotals();
        if (!currentTotals) throw new Error("Unable to load totals");
        if (currentTotals.escrowed <= 0n) throw new Error("No escrowed funds to payout");

        const payouts = splitPayouts(currentTotals.escrowed, claimerShares, claimers);
        if (payouts.length === 0) {
          pushLog("No payouts selected (all shares are 0).");
          return;
        }

        for (const p of payouts) {
          const hash = await wc.writeContract({
            address: contractAddress,
            abi: ghBountiesAbi,
            functionName: "payout",
            args: [derived.bountyId, currentTotals.token, p.recipient as Address, p.amount],
            account
          });
          pushLog(`payout(${p.recipient}) tx: ${hash}`);
        }
        return;
      }

      if (!isAddress(recipient)) throw new Error("Invalid recipient address");
      if (asset === "ETH") {
        const hash = await wc.writeContract({
          address: contractAddress,
          abi: ghBountiesAbi,
          functionName: "payout",
          args: [derived.bountyId, token as Address, recipient as Address, parseEther(payoutAmount)],
          account
        });
        pushLog(`payout(ETH) tx: ${hash}`);
      } else {
        const t = tokenAddress.trim();
        if (!isAddress(t)) throw new Error("Invalid token address");

        const pc = getPublicClient();
        let decimals = 6;
        try {
          decimals = Number(
            (await pc.readContract({
              address: t as Address,
              abi: erc20Abi,
              functionName: "decimals"
            })) as any
          );
        } catch {
          decimals = 6;
        }

        const amount = parseUnits(payoutAmount, decimals);
        const hash = await wc.writeContract({
          address: contractAddress,
          abi: ghBountiesAbi,
          functionName: "payout",
          args: [derived.bountyId, t as Address, recipient as Address, amount],
          account
        });
        pushLog(`payout(token) tx: ${hash}`);
      }
    } catch (e: any) {
      pushLog(e?.shortMessage ?? e?.message ?? String(e));
    }
  }

  async function readEscrowed() {
    if (!derived) return;
    try {
      const currentTotals = await fetchTotals();
      if (!currentTotals) return;
      const { escrowed, funded, paid, decimals, token: t } = currentTotals;
      pushLog(
        `token=${t} escrowed=${formatUnits(escrowed, decimals)} funded=${formatUnits(funded, decimals)} paid=${formatUnits(paid, decimals)}`
      );
    } catch (e: any) {
      pushLog(e?.shortMessage ?? e?.message ?? String(e));
    }
  }

  async function refreshClaims() {
    if (!derived) return;
    try {
      const res = await fetch(`${apiUrl}/bounties?bountyId=${encodeURIComponent(derived.bountyId)}`);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = (await res.json()) as any;
      const cs = (data?.bounty?.claims ?? []).map((c: any) => ({
        claimId: c.claimId as number,
        claimer: c.claimer as string,
        metadataURI: c.metadataURI as string
      }));
      setClaims(cs);
      pushLog(`claims loaded: ${cs.length}`);
    } catch (e: any) {
      pushLog(e?.message ?? String(e));
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">gh-bounties</h1>
            <p className="mt-2 text-zinc-300">
              Attach ETH to a GitHub issue. Submit a PR to claim. Maintainer approves payout.
            </p>
          </div>
          <button
            className="rounded-full bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-zinc-200"
            onClick={connect}
          >
            {wallet ? `Connected: ${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "Connect wallet"}
          </button>
        </div>
        {walletWarning ? (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            {walletWarning} Make sure your wallet network and RPC match the app config.
          </div>
        ) : null}

        <div className="mt-10 grid gap-6">
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
            <h2 className="text-lg font-semibold">Issue</h2>
            <div className="mt-3 grid gap-3">
              <label className="text-sm text-zinc-300">GitHub issue URL</label>
              <input
                value={issueUrl}
                onChange={(e) => setIssueUrl(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm outline-none focus:border-zinc-600"
                placeholder="https://github.com/owner/repo/issues/123"
              />
              <div className="text-xs text-zinc-400">
                {parsed ? (
                  <>
                    repo: <span className="text-zinc-200">{parsed.repoId}</span> • issue:{" "}
                    <span className="text-zinc-200">#{parsed.issueNumber}</span>
                  </>
                ) : (
                  "Paste a valid GitHub issue URL"
                )}
              </div>
              <div className="text-xs text-zinc-400">
                repoHash: <span className="text-zinc-200">{derived?.repoHash ?? "-"}</span>
              </div>
              <div className="text-xs text-zinc-400">
                bountyId: <span className="text-zinc-200">{derived?.bountyId ?? "-"}</span>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
            <h2 className="text-lg font-semibold">Actions</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button
                className="sm:col-span-2 rounded-xl bg-zinc-100 px-4 py-3 text-sm font-medium text-zinc-950 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-zinc-100"
                onClick={registerRepo}
                disabled={txDisabled}
              >
                Register repo (maintainer)
              </button>
              <div className="sm:col-span-2 grid gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="text-sm font-medium text-zinc-100">Funding asset</div>
                  <div className="flex items-center gap-2 text-sm">
                    <button
                      className={`rounded-full px-3 py-1 ${
                        asset === "ETH"
                          ? "bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
                          : "bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
                      }`}
                      onClick={() => setAsset("ETH")}
                      type="button"
                    >
                      ETH
                    </button>
                    <button
                      className={`rounded-full px-3 py-1 ${
                        asset === "TOKEN"
                          ? "bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
                          : "bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
                      }`}
                      onClick={() => setAsset("TOKEN")}
                      type="button"
                    >
                      ERC20 (USDC)
                    </button>
                  </div>
                </div>
                {asset === "TOKEN" ? (
                  <input
                    value={tokenAddress}
                    onChange={(e) => setTokenAddress(e.target.value)}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm outline-none focus:border-zinc-600"
                    placeholder="USDC token address (0x...)"
                  />
                ) : null}
                <div className="flex flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <div className="text-sm text-zinc-300">Lock days</div>
                    <input
                      value={lockDays}
                      onChange={(e) => setLockDays(e.target.value)}
                      className="w-24 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-zinc-600"
                      placeholder="7"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm text-zinc-300">Amount</div>
                    <input
                      value={fundAmount}
                      onChange={(e) => setFundAmount(e.target.value)}
                      className="w-32 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-zinc-600"
                      placeholder="0.01"
                    />
                  </div>
                  <button
                    className="flex-1 rounded-xl bg-zinc-100 px-4 py-3 text-sm font-medium text-zinc-950 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-zinc-100"
                    onClick={fundBounty}
                    disabled={txDisabled}
                  >
                    Fund bounty
                  </button>
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="text-sm text-zinc-300">PR URL (claim)</label>
                <input
                  value={prUrl}
                  onChange={(e) => setPrUrl(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm outline-none focus:border-zinc-600"
                  placeholder="https://github.com/owner/repo/pull/999"
                />
                <button
                  className="mt-3 w-full rounded-xl bg-zinc-100 px-4 py-3 text-sm font-medium text-zinc-950 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-zinc-100"
                  onClick={submitClaim}
                  disabled={txDisabled}
                >
                  Submit claim
                </button>
              </div>

              <div className="sm:col-span-2 grid gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <div className="text-sm font-medium text-zinc-100">Admin payout</div>
                {claimers.length > 1 ? (
                  <>
                    <div className="text-sm text-zinc-400">Payout recipients (split by share)</div>
                    <div className="text-xs text-zinc-400">
                      Total escrowed:{" "}
                      <span className="text-zinc-200">
                        {totals ? formatUnits(totals.escrowed, totals.decimals) : "—"}
                      </span>
                    </div>
                    <div className="grid gap-3">
                      {payoutSplits.map((row) => (
                        <div key={row.claimer} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                          <div className="flex items-center justify-between text-xs text-zinc-400">
                            <span className="truncate">{row.claimer}</span>
                            <span className="text-zinc-200">{row.share}%</span>
                          </div>
                          <div className="mt-2 flex items-center gap-3">
                            <input
                              type="range"
                              min="0"
                              max="100"
                              step="1"
                              value={row.share}
                              onChange={(e) => updateShare(row.claimer, Number(e.target.value))}
                              className="w-full accent-zinc-100"
                            />
                            <div className="w-28 text-right text-xs text-zinc-300">
                              {totals ? formatUnits(row.amount ?? 0n, totals.decimals) : "—"}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-3">
                      <button
                        className="flex-1 rounded-xl bg-zinc-100 px-4 py-3 text-sm font-medium text-zinc-950 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-zinc-100"
                        onClick={payout}
                        disabled={txDisabled}
                      >
                        Payout
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-sm text-zinc-400">Payout recipient (from claims)</div>
                    <select
                      value={claimers.includes(payoutRecipient) ? payoutRecipient : ""}
                      onChange={(e) => setPayoutRecipient(e.target.value)}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-600 disabled:opacity-50"
                      disabled={claimers.length === 0}
                    >
                      <option value="">{claimers.length === 0 ? "No claimers loaded" : "Select a claimer"}</option>
                      {claimers.map((claimer) => (
                        <option key={claimer} value={claimer}>
                          {claimer}
                        </option>
                      ))}
                    </select>
                    <input
                      value={payoutRecipient}
                      onChange={(e) => setPayoutRecipient(e.target.value)}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm outline-none focus:border-zinc-600"
                      placeholder="recipient 0x..."
                    />
                    <div className="flex gap-3">
                      <input
                        value={payoutAmount}
                        onChange={(e) => setPayoutAmount(e.target.value)}
                        className="w-36 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm outline-none focus:border-zinc-600"
                        placeholder="0.01"
                      />
                      <button
                        className="flex-1 rounded-xl bg-zinc-100 px-4 py-3 text-sm font-medium text-zinc-950 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-zinc-100"
                        onClick={payout}
                        disabled={txDisabled}
                      >
                        Payout
                      </button>
                    </div>
                  </>
                )}
              </div>

              <button
                className="sm:col-span-2 rounded-xl border border-zinc-700 bg-transparent px-4 py-3 text-sm font-medium text-zinc-100 hover:bg-zinc-900"
                onClick={readEscrowed}
              >
                Refresh escrow totals
              </button>
              <button
                className="sm:col-span-2 rounded-xl border border-zinc-700 bg-transparent px-4 py-3 text-sm font-medium text-zinc-100 hover:bg-zinc-900"
                onClick={refreshClaims}
              >
                Refresh claims (from API)
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
            <h2 className="text-lg font-semibold">Claims</h2>
            <div className="mt-3 grid gap-2">
              {claims.length === 0 ? (
                <div className="text-sm text-zinc-400">No claims loaded.</div>
              ) : (
                claims.map((c) => (
                  <div key={c.claimId} className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm">
                    <div className="text-zinc-200">
                      claim #{c.claimId} • <span className="text-zinc-400">{c.claimer}</span>
                    </div>
                    <div className="mt-2 break-all text-zinc-300">{c.metadataURI}</div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
            <h2 className="text-lg font-semibold">Log</h2>
            <div className="mt-3 whitespace-pre-wrap rounded-xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs text-zinc-200">
              {log.length === 0 ? "…" : log.join("\n")}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
