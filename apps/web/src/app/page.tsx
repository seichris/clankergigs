"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits, isAddress, parseEther, parseUnits, type Address } from "viem";
import { bountyId as computeBountyId, repoHash as computeRepoHash, usdcAddressForChainId } from "@gh-bounties/shared";
import { erc20Abi, ghBountiesAbi } from "@/lib/abi";
import { parseGithubIssueUrl } from "@/lib/gh";
import { getConfig, getPublicClient, getWalletClient, requestAccounts } from "@/lib/wallet";

export default function Home() {
  const [wallet, setWallet] = useState<Address | null>(null);
  const [issueUrl, setIssueUrl] = useState("https://github.com/commaai/openpilot/issues/123");
  const [prUrl, setPrUrl] = useState("https://github.com/commaai/openpilot/pull/999");
  const [asset, setAsset] = useState<"ETH" | "TOKEN">("ETH");
  const [tokenAddress, setTokenAddress] = useState("");
  const [fundAmount, setFundAmount] = useState("0.01");
  const [lockDays, setLockDays] = useState("7");
  const [payoutRecipient, setPayoutRecipient] = useState("");
  const [payoutAmount, setPayoutAmount] = useState("0.01");
  const [claims, setClaims] = useState<Array<{ claimId: number; claimer: string; metadataURI: string }>>([]);
  const [log, setLog] = useState<string>("");

  const parsed = useMemo(() => {
    try {
      return parseGithubIssueUrl(issueUrl);
    } catch {
      return null;
    }
  }, [issueUrl]);

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

  // Small UX helper: when switching to TOKEN, auto-fill USDC for known chains if empty.
  useEffect(() => {
    if (asset !== "TOKEN") return;
    if (tokenAddress.trim().length > 0) return;
    const addr = usdcAddressForChainId(chainId);
    if (addr) setTokenAddress(addr);
  }, [asset, chainId, tokenAddress]);

  async function connect() {
    try {
      const addr = await requestAccounts();
      setWallet(addr);
      setLog(`connected: ${addr}`);
    } catch (e: any) {
      setLog(e?.message ?? String(e));
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
      setLog(`registerRepo tx: ${hash}`);
    } catch (e: any) {
      setLog(e?.shortMessage ?? e?.message ?? String(e));
    }
  }

  async function createBounty() {
    if (!derived || !parsed) return;
    try {
      const { contractAddress } = getConfig();
      const wc = getWalletClient();
      const [account] = await wc.getAddresses();

      const hash = await wc.writeContract({
        address: contractAddress,
        abi: ghBountiesAbi,
        functionName: "createBounty",
        args: [derived.repoHash, BigInt(parsed.issueNumber), issueUrl],
        account
      });
      setLog(`createBounty tx: ${hash}`);
    } catch (e: any) {
      setLog(e?.shortMessage ?? e?.message ?? String(e));
    }
  }

  async function fundBounty() {
    if (!derived) return;
    try {
      const { contractAddress } = getConfig();
      const wc = getWalletClient();
      const [account] = await wc.getAddresses();

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
        setLog(`fundBountyETH tx: ${hash}`);
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
        setLog(`approve tx: ${approveTx}`);

        const fundTx = await wc.writeContract({
          address: contractAddress,
          abi: ghBountiesAbi,
          functionName: "fundBountyToken",
          args: [derived.bountyId, t as Address, amount, BigInt(lockSeconds)],
          account
        });
        setLog(`fundBountyToken tx: ${fundTx}`);
      }
    } catch (e: any) {
      setLog(e?.shortMessage ?? e?.message ?? String(e));
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
      setLog(`submitClaim tx: ${hash}`);
    } catch (e: any) {
      setLog(e?.shortMessage ?? e?.message ?? String(e));
    }
  }

  async function payout() {
    if (!derived) return;
    try {
      const recipient = payoutRecipient.trim();
      if (!isAddress(recipient)) throw new Error("Invalid recipient address");

      const { contractAddress } = getConfig();
      const wc = getWalletClient();
      const [account] = await wc.getAddresses();

      if (asset === "ETH") {
        const hash = await wc.writeContract({
          address: contractAddress,
          abi: ghBountiesAbi,
          functionName: "payout",
          args: [derived.bountyId, token as Address, recipient as Address, parseEther(payoutAmount)],
          account
        });
        setLog(`payout(ETH) tx: ${hash}`);
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
        setLog(`payout(token) tx: ${hash}`);
      }
    } catch (e: any) {
      setLog(e?.shortMessage ?? e?.message ?? String(e));
    }
  }

  async function readEscrowed() {
    if (!derived) return;
    try {
      const { contractAddress } = getConfig();
      const pc = getPublicClient();
      const t = asset === "ETH" ? ("0x0000000000000000000000000000000000000000" as Address) : (tokenAddress.trim() as Address);
      if (asset !== "ETH" && !isAddress(t)) throw new Error("Invalid token address");

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

      const [escrowed0, funded0, paid0] = res;
      setLog(
        `token=${t} escrowed=${formatUnits(escrowed0, decimals)} funded=${formatUnits(funded0, decimals)} paid=${formatUnits(paid0, decimals)}`
      );
    } catch (e: any) {
      setLog(e?.shortMessage ?? e?.message ?? String(e));
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
      setLog(`claims loaded: ${cs.length}`);
    } catch (e: any) {
      setLog(e?.message ?? String(e));
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
            className="rounded-full bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-white"
            onClick={connect}
          >
            {wallet ? `Connected: ${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "Connect wallet"}
          </button>
        </div>

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
              <button className="rounded-xl bg-zinc-100 px-4 py-3 text-sm font-medium text-zinc-950" onClick={registerRepo}>
                Register repo (maintainer)
              </button>
              <button className="rounded-xl bg-zinc-100 px-4 py-3 text-sm font-medium text-zinc-950" onClick={createBounty}>
                Create bounty
              </button>
              <div className="sm:col-span-2 grid gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="text-sm font-medium text-zinc-100">Funding asset</div>
                  <div className="flex items-center gap-2 text-sm">
                    <button
                      className={`rounded-full px-3 py-1 ${asset === "ETH" ? "bg-zinc-100 text-zinc-950" : "bg-zinc-800 text-zinc-100"}`}
                      onClick={() => setAsset("ETH")}
                      type="button"
                    >
                      ETH
                    </button>
                    <button
                      className={`rounded-full px-3 py-1 ${asset === "TOKEN" ? "bg-zinc-100 text-zinc-950" : "bg-zinc-800 text-zinc-100"}`}
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
                  <button className="flex-1 rounded-xl bg-zinc-100 px-4 py-3 text-sm font-medium text-zinc-950" onClick={fundBounty}>
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
                <button className="mt-3 w-full rounded-xl bg-zinc-100 px-4 py-3 text-sm font-medium text-zinc-950" onClick={submitClaim}>
                  Submit claim
                </button>
              </div>

              <div className="sm:col-span-2 grid gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <div className="text-sm font-medium text-zinc-100">Admin payout</div>
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
                  <button className="flex-1 rounded-xl bg-zinc-100 px-4 py-3 text-sm font-medium text-zinc-950" onClick={payout}>
                    Payout
                  </button>
                </div>
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
            <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs text-zinc-200">
              {log || "…"}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
