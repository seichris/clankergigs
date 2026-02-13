"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Address, Hex } from "viem";
import { formatUnits } from "viem";
import { usdcAddressForChainId } from "@gh-bounties/shared";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FundIssueDialog } from "@/components/fund-issue-dialog";
import { ClaimBountyDialog } from "@/components/claim-bounty-dialog";
import { PayOutBountyDialog } from "@/components/pay-out-bounty-dialog";
import { ghBountiesAbi } from "@/lib/abi";
import { parseGithubIssueUrl } from "@/lib/gh";
import { useGithubUser } from "@/lib/hooks/useGithubUser";
import { useWallet } from "@/lib/hooks/useWallet";
import { getConfig, getPublicClient } from "@/lib/wallet";

const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";

type BountyAsset = {
  token: string;
  escrowed: string;
  funded: string;
  paid: string;
};

type BountyDetail = {
  bountyId: string;
  metadataURI: string;
  status: string;
  chainId: number;
  contractAddress: string;
  createdAt: string;
  updatedAt: string;
  assets: BountyAsset[];
  fundings: Array<{ txHash: string; funder?: string | null }>;
  claims: Array<{ claimId: number; metadataURI: string; txHash: string }>;
  payouts: Array<{ txHash: string }>;
  refunds: Array<{ txHash: string }>;
  linkedPullRequests?: Array<{ prUrl: string; author?: string | null }>;
};

type GithubIssueSummary = {
  title: string;
  htmlUrl: string;
  state: string;
  labels: Array<{ name: string; color: string }>;
};

function shortHex(value: string, chars = 6) {
  if (!value) return "-";
  if (value.length <= chars * 2 + 2) return value;
  return `${value.slice(0, chars + 2)}…${value.slice(-chars)}`;
}

function statusVariant(status: string): "success" | "secondary" | "outline" | "default" {
  const normalized = status.toUpperCase();
  if (normalized === "OPEN") return "success";
  if (normalized === "IMPLEMENTED") return "secondary";
  if (normalized === "CLOSED") return "outline";
  return "default";
}

function tokenMeta(token: string, chainId: number) {
  if (token.toLowerCase() === ETH_ADDRESS.toLowerCase()) return { symbol: "ETH", decimals: 18 };
  const usdc = usdcAddressForChainId(chainId);
  if (usdc && token.toLowerCase() === usdc.toLowerCase()) return { symbol: "USDC", decimals: 6 };
  return { symbol: shortHex(token), decimals: 18 };
}

function formatTokenAmount(value: string, decimals: number) {
  try {
    return formatUnits(BigInt(value), decimals);
  } catch {
    return value;
  }
}

export default function BountyPage() {
  const params = useParams<{ bountyId: string }>();
  const bountyId = React.useMemo(() => {
    const raw = params?.bountyId;
    if (Array.isArray(raw)) return raw[0] || "";
    return raw || "";
  }, [params]);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787";
  const { address, hasProvider, connect } = useWallet();
  const { user, login, logout } = useGithubUser(apiUrl);

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [bounty, setBounty] = React.useState<BountyDetail | null>(null);
  const [githubIssue, setGithubIssue] = React.useState<GithubIssueSummary | null>(null);
  const [fundOpen, setFundOpen] = React.useState(false);
  const [claimOpen, setClaimOpen] = React.useState(false);
  const [payOutOpen, setPayOutOpen] = React.useState(false);
  const [refreshNonce, setRefreshNonce] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    const run = async () => {
      setLoading(true);
      setError(null);
      setBounty(null);
      setGithubIssue(null);
      try {
        const res = await fetch(`${apiUrl}/bounties?bountyId=${encodeURIComponent(bountyId)}`, { credentials: "include" });
        if (!res.ok) throw new Error(`Failed to load bounty (${res.status})`);
        const json = (await res.json()) as { bounty?: BountyDetail | null };
        const nextBounty = json?.bounty ?? null;
        if (!active) return;
        setBounty(nextBounty);
        if (!nextBounty?.metadataURI) return;

        const issueRes = await fetch(`${apiUrl}/github/issue?url=${encodeURIComponent(nextBounty.metadataURI)}`, {
          credentials: "include"
        });
        if (!issueRes.ok) return;
        const issueJson = (await issueRes.json()) as { issue?: GithubIssueSummary | null };
        if (!active) return;
        setGithubIssue(issueJson?.issue ?? null);
      } catch (err: unknown) {
        if (!active) return;
        const msg =
          typeof err === "object" && err !== null && "message" in err
            ? String((err as { message?: unknown }).message || "Failed to load bounty")
            : "Failed to load bounty";
        setError(msg);
      } finally {
        if (!active) return;
        setLoading(false);
      }
    };

    if (bountyId) {
      void run();
    } else {
      setLoading(false);
      setError("Invalid bounty id");
    }

    return () => {
      active = false;
    };
  }, [apiUrl, bountyId, refreshNonce]);

  const parsedIssue = React.useMemo(() => {
    if (!bounty?.metadataURI) return null;
    try {
      return parseGithubIssueUrl(bounty.metadataURI);
    } catch {
      return null;
    }
  }, [bounty?.metadataURI]);

  const isRepoOwner = Boolean(
    parsedIssue?.owner &&
      user &&
      parsedIssue.owner.toLowerCase() === user.login.toLowerCase()
  );

  const isFunder = Boolean(
    address &&
      bounty?.fundings?.some((f) => f.funder && f.funder.toLowerCase() === address.toLowerCase())
  );

  const [onchainTotalsByToken, setOnchainTotalsByToken] = React.useState<
    Record<string, { escrowed: string; funded: string; paid: string }> | null
  >(null);

  React.useEffect(() => {
    if (!bountyId) return;
    if (!bounty) return;
    if (bounty.assets.length === 0) return;

    let active = true;
    const pc = getPublicClient();
    const { contractAddress } = getConfig();
    const tokens = bounty.assets.map((a) => a.token.toLowerCase());

    (async () => {
      try {
        const rows = await Promise.all(
          tokens.map(async (token) => {
            const res = (await pc.readContract({
              address: contractAddress,
              abi: ghBountiesAbi,
              functionName: "getTotals",
              args: [bountyId as Hex, token as Address],
            })) as readonly [bigint, bigint, bigint];
            return { token, escrowed: res[0].toString(), funded: res[1].toString(), paid: res[2].toString() };
          })
        );
        if (!active) return;
        const map: Record<string, { escrowed: string; funded: string; paid: string }> = {};
        for (const r of rows) map[r.token] = { escrowed: r.escrowed, funded: r.funded, paid: r.paid };
        setOnchainTotalsByToken(map);
      } catch {
        if (!active) return;
        setOnchainTotalsByToken(null);
      }
    })();

    return () => {
      active = false;
    };
  }, [bountyId, bounty]);

  const escrowedByToken = React.useMemo(() => {
    if (!bounty) return undefined;
    return bounty.assets.reduce<Record<string, string>>((acc, asset) => {
      const key = asset.token.toLowerCase();
      acc[key] = onchainTotalsByToken?.[key]?.escrowed ?? asset.escrowed;
      return acc;
    }, {});
  }, [bounty, onchainTotalsByToken]);

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="outline" size="sm">
            <Link href="/">Back to all bounties</Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            {!address ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => connect().catch((err) => window.alert(err?.message ?? String(err)))}
                disabled={!hasProvider}
              >
                {hasProvider ? "Connect wallet" : "No wallet detected"}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(address)}>
                {address.slice(0, 6)}…{address.slice(-4)}
              </Button>
            )}
            {!user ? (
              <Button variant="outline" size="sm" onClick={() => login()}>
                Connect GitHub
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => logout()}>
                GitHub: @{user.login}
              </Button>
            )}
            <span className="font-mono text-xs text-muted-foreground">{bountyId || "-"}</span>
          </div>
        </div>

        {loading ? <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">Loading bounty…</div> : null}
        {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
        {!loading && !error && !bounty ? <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">Bounty not found.</div> : null}

        {bounty ? (
          <section className="grid gap-6 rounded-md border bg-card p-6">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold">
                {githubIssue?.title || (parsedIssue ? `${parsedIssue.owner}/${parsedIssue.repo} #${parsedIssue.issueNumber}` : "Bounty detail")}
              </h1>
              <Badge variant={statusVariant(bounty.status)}>{bounty.status}</Badge>
            </div>

            <div className="grid gap-2 text-sm text-muted-foreground">
              <div className="font-mono text-xs">bountyId: {bounty.bountyId}</div>
              <div className="font-mono text-xs">contract: {bounty.contractAddress}</div>
              <div className="text-xs">chainId: {bounty.chainId}</div>
              <div className="text-xs">created: {new Date(bounty.createdAt).toLocaleString()}</div>
              <div className="text-xs">updated: {new Date(bounty.updatedAt).toLocaleString()}</div>
            </div>

            <div className="grid gap-2">
              <div className="text-xs uppercase text-muted-foreground">Issue</div>
              <a
                href={githubIssue?.htmlUrl || bounty.metadataURI}
                target="_blank"
                rel="noreferrer"
                className="break-all text-sm text-primary hover:underline"
              >
                {githubIssue?.htmlUrl || bounty.metadataURI}
              </a>
            </div>

            <div className="grid gap-2">
              <div className="text-xs uppercase text-muted-foreground">Assets</div>
              {bounty.assets.length > 0 ? (
                <div className="grid gap-2 text-sm">
                  {onchainTotalsByToken ? (
                    <div className="rounded border bg-muted/30 p-2 text-xs text-muted-foreground">
                      Showing on-chain totals (indexed totals may be stale).
                    </div>
                  ) : null}
                  {bounty.assets.map((asset) => {
                    const meta = tokenMeta(asset.token, bounty.chainId);
                    const key = asset.token.toLowerCase();
                    const totals = onchainTotalsByToken?.[key];
                    const funded = totals?.funded ?? asset.funded;
                    const escrowed = totals?.escrowed ?? asset.escrowed;
                    const paid = totals?.paid ?? asset.paid;
                    return (
                      <div key={asset.token} className="rounded border bg-muted/40 p-3">
                        <div className="font-medium">{meta.symbol}</div>
                        <div className="text-xs text-muted-foreground">Funded: {formatTokenAmount(funded, meta.decimals)}</div>
                        <div className="text-xs text-muted-foreground">In active bounty: {formatTokenAmount(escrowed, meta.decimals)}</div>
                        <div className="text-xs text-muted-foreground">Paid: {formatTokenAmount(paid, meta.decimals)}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No assets recorded yet.</div>
              )}
            </div>

            <div className="grid gap-2 text-sm text-muted-foreground">
              <div>Fundings: {bounty.fundings.length}</div>
              <div>Claims: {bounty.claims.length}</div>
              <div>Payouts: {bounty.payouts.length}</div>
              <div>Refunds: {bounty.refunds.length}</div>
              <div>Linked PRs: {bounty.linkedPullRequests?.length ?? 0}</div>
            </div>
          </section>
        ) : null}

        {bounty ? (
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                if (!address) {
                  window.alert("Connect a wallet to fund this bounty.");
                  return;
                }
                setFundOpen(true);
              }}
            >
              Fund bounty
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (!address) {
                  window.alert("Connect a wallet to submit a claim.");
                  return;
                }
                setClaimOpen(true);
              }}
            >
              Submit claim
            </Button>
            {isRepoOwner || isFunder ? (
              <Button variant="secondary" onClick={() => setPayOutOpen(true)}>
                Pay out bounty
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <FundIssueDialog
        open={fundOpen}
        onOpenChange={(next) => {
          if (next && !address) return;
          setFundOpen(next);
        }}
        walletAddress={address}
        defaultIssueUrl={bounty?.metadataURI ?? null}
        onFunded={() => {
          setFundOpen(false);
          setRefreshNonce((n) => n + 1);
        }}
      />

      <ClaimBountyDialog
        open={claimOpen}
        onOpenChange={(next) => setClaimOpen(next)}
        walletAddress={address}
        bountyId={bounty?.bountyId ?? null}
        issueUrl={bounty?.metadataURI ?? null}
        apiUrl={apiUrl}
        githubUser={user}
        onGithubLogin={login}
        onClaimed={() => setRefreshNonce((n) => n + 1)}
      />

      <PayOutBountyDialog
        open={payOutOpen}
        onOpenChange={setPayOutOpen}
        walletAddress={address}
        onWalletConnect={connect}
        githubUser={user}
        onGithubLogin={login}
        bountyId={bounty?.bountyId ?? null}
        issueUrl={bounty?.metadataURI ?? null}
        apiUrl={apiUrl}
        escrowedByToken={escrowedByToken}
        isFunder={isFunder}
        onPayouted={() => setRefreshNonce((n) => n + 1)}
      />
    </main>
  );
}
