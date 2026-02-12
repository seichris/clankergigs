"use client";

import * as React from "react";
import { ChevronDown, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FundIssueDialog } from "@/components/fund-issue-dialog";
import { ClaimBountyDialog } from "@/components/claim-bounty-dialog";
import { PayOutBountyDialog } from "@/components/pay-out-bounty-dialog";
import { createIssueColumns } from "@/components/issues-table/columns";
import { IssuesDataTable } from "@/components/issues-table/data-table";
import type { IssueRow } from "@/components/issues-table/types";
import { normalizeGithubUsername } from "@/lib/ens";
import { useEnsAvatarUrl, useEnsPrimaryName, useEnsTextRecord } from "@/lib/hooks/useEns";
import { useGithubUser } from "@/lib/hooks/useGithubUser";
import { useTheme } from "@/lib/hooks/useTheme";
import { useWallet } from "@/lib/hooks/useWallet";
import { usdcAddressForChainId } from "@gh-bounties/shared";

function shortAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function addressGradientStyle(addr: string) {
  const hex = addr.toLowerCase().replace(/^0x/, "");
  const a = parseInt(hex.slice(0, 6), 16) % 360;
  const b = parseInt(hex.slice(6, 12), 16) % 360;
  return {
    backgroundImage: `linear-gradient(135deg, hsl(${a} 70% 55%), hsl(${b} 70% 55%))`,
  } as React.CSSProperties;
}

function chainLabel(chainId: number) {
  if (chainId === 1) return "Ethereum";
  if (chainId === 11155111) return "Sepolia";
  if (chainId === 31337) return "Local";
  return `Chain ${chainId}`;
}

function errorMessage(err: unknown) {
  if (typeof err === "object" && err !== null && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg.length > 0) return msg;
  }
  return String(err);
}

const LOCALHOST_EXAMPLE_ISSUE_URL = "https://github.com/seichris/gh-bounties/issues/1";
const LOCALHOST_EXAMPLE_REPO_HASH = "0xac7d22e9cb7dbe5c2fa30e22e4960651bda682f14815ec7c1adeaf68fbf138e3";
const LOCALHOST_EXAMPLE_BOUNTY_ID = "0x4f368e964bac0fa471369f7854c49d29dbaa3a9f68d1a10b948ffd5bc64ac567";

function isLocalhost() {
  if (typeof window === "undefined") return false;
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

function localhostExampleIssue(chainId: number): IssueRow {
  // Keep this deterministic so it doesn't change across re-renders.
  const base = Date.parse("2026-01-01T12:00:00.000Z");
  const isoAtDay = (day: number, hour = 12) => new Date(base + (day * 24 + hour) * 60 * 60 * 1000).toISOString();

  const now = isoAtDay(0);
  const escrowedWei = "31000000000000000"; // 0.031 ETH
  const fundedWei = "83000000000000000"; // 0.083 ETH
  const usdc = usdcAddressForChainId(chainId);
  const usdcFundedWei = "125000000"; // 125 USDC (6 decimals)
  const usdcEscrowedWei = "50000000"; // 50 USDC (6 decimals)

  return {
    issueUrl: LOCALHOST_EXAMPLE_ISSUE_URL,
    owner: "seichris",
    repo: "gh-bounties",
    issueNumber: 1,
    repoHash: LOCALHOST_EXAMPLE_REPO_HASH,
    bountyId: LOCALHOST_EXAMPLE_BOUNTY_ID,
    status: "OPEN",
    chainId,
    contractAddress: "0x0000000000000000000000000000000000000001",
    createdAt: now,
    updatedAt: isoAtDay(14, 9),
    assets: [
      {
        token: "0x0000000000000000000000000000000000000000",
        fundedWei,
        escrowedWei,
        paidWei: "0",
      },
      ...(usdc
        ? ([
            {
              token: usdc,
              fundedWei: usdcFundedWei,
              escrowedWei: usdcEscrowedWei,
              paidWei: "0",
            },
          ] satisfies IssueRow["assets"])
        : []),
    ],
    unlockSchedule: [
      {
        token: "0x0000000000000000000000000000000000000000",
        totalEscrowedWei: escrowedWei,
        days: [
          // Simulate multiple funders choosing different lock durations.
          { day: 0, amountWei: "4000000000000000" },  // 0.004
          { day: 1, amountWei: "6000000000000000" },  // 0.006
          { day: 3, amountWei: "5000000000000000" },  // 0.005
          { day: 7, amountWei: "7000000000000000" },  // 0.007
          { day: 14, amountWei: "9000000000000000" }, // 0.009
        ],
      },
      ...(usdc
        ? ([
            {
              token: usdc,
              totalEscrowedWei: usdcEscrowedWei,
              days: [
                // 50 USDC total
                { day: 0, amountWei: "5000000" }, // 5
                { day: 2, amountWei: "10000000" }, // 10
                { day: 5, amountWei: "15000000" }, // 15
                { day: 10, amountWei: "20000000" }, // 20
              ],
            },
          ] satisfies IssueRow["unlockSchedule"])
        : []),
    ],
		    activityTimeline: {
		      startDate: isoAtDay(0),
		      endDate: isoAtDay(14),
	      maxDay: 14,
	      days: [
	        {
	          day: 0,
	          events: [
	            { type: "funding", timestamp: isoAtDay(0, 1) },
	            { type: "funding", timestamp: isoAtDay(0, 3) },
	          ],
	        },
	        {
	          day: 1,
	          events: [{ type: "funding", timestamp: isoAtDay(1, 2) }],
	        },
	        {
	          day: 3,
	          events: [
	            { type: "funding", timestamp: isoAtDay(3, 4) },
	            { type: "funding", timestamp: isoAtDay(3, 9) },
	            { type: "linked_pr", timestamp: isoAtDay(3, 10) },
	          ],
	        },
	        {
	          day: 5,
	          events: [{ type: "claim", timestamp: isoAtDay(5, 11) }],
	        },
	        {
	          day: 7,
	          events: [{ type: "funding", timestamp: isoAtDay(7, 6) }],
	        },
	        {
	          day: 10,
	          events: [{ type: "linked_pr", timestamp: isoAtDay(10, 15) }],
	        },
	        {
	          day: 14,
	          events: [{ type: "funding", timestamp: isoAtDay(14, 8) }],
	        },
	      ],
	    },
    funders: [
      "0x000000000000000000000000000000000000dEaD",
      "0x000000000000000000000000000000000000bEEF",
      "0x000000000000000000000000000000000000c0Fe",
    ],
    linkedPullRequests: [
      { prUrl: "https://github.com/seichris/gh-bounties/pull/3", createdAt: isoAtDay(3, 10) },
      { prUrl: "https://github.com/seichris/gh-bounties/pull/34", createdAt: isoAtDay(10, 15) },
    ],
    counts: {
      fundings: 7,
      claims: 1,
      payouts: 0,
      refunds: 0,
      linkedPrs: 2,
    },
    github: {
      title: "Example bounty (localhost only)",
      state: "open",
      labels: [
        { name: "example", color: "6e7681" },
        { name: "ui", color: "0e8a16" },
      ],
      updatedAt: now,
      htmlUrl: LOCALHOST_EXAMPLE_ISSUE_URL,
      author: { login: "octocat", avatar_url: null },
      repo: {
        description: "Local UI example row (not on-chain).",
        homepage: null,
        htmlUrl: "https://github.com/seichris/gh-bounties",
      },
    },
  };
}

export default function Home() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787";
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "31337");
  const mainnetWebOrigin = (process.env.NEXT_PUBLIC_WEB_ORIGIN_ETHEREUM_MAINNET || "").trim();
  const sepoliaWebOrigin = (process.env.NEXT_PUBLIC_WEB_ORIGIN_ETHEREUM_SEPOLIA || "").trim();
  const { address, hasProvider, connect } = useWallet();
  const { user, login, logout } = useGithubUser(apiUrl);
  const { theme, setTheme, mounted } = useTheme();
  const { name: ensName } = useEnsPrimaryName(address);
  const { avatarUrl: ensAvatarUrl } = useEnsAvatarUrl(ensName);
  const { value: ensGithub } = useEnsTextRecord(ensName && user ? ensName : null, "com.github");

  const [issues, setIssues] = React.useState<IssueRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [prefillIssueUrl, setPrefillIssueUrl] = React.useState<string | null>(null);
  const [myFundingOnly, setMyFundingOnly] = React.useState(false);
  const [claimIssue, setClaimIssue] = React.useState<IssueRow | null>(null);
  const [claimOpen, setClaimOpen] = React.useState(false);
  const [payOutIssue, setPayOutIssue] = React.useState<IssueRow | null>(null);
  const [payOutOpen, setPayOutOpen] = React.useState(false);

  const displayedIssues = React.useMemo(() => {
    if (!isLocalhost()) return issues;
    if (issues.length > 0) return issues;
    return [localhostExampleIssue(chainId)];
  }, [issues, chainId]);

  const fetchIssues = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/issues?include=github`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load issues (${res.status})`);
      const json = (await res.json()) as { issues?: IssueRow[] };
      setIssues(json?.issues ?? []);
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  React.useEffect(() => {
    fetchIssues().catch(() => {
      // handled in fetchIssues
    });
  }, [fetchIssues]);

  React.useEffect(() => {
    if (!address) setMyFundingOnly(false);
  }, [address]);

  const handleAddFunds = React.useCallback(
    (issue?: IssueRow) => {
      if (!address) {
        window.alert("Connect a wallet to fund issues.");
        return;
      }
      setPrefillIssueUrl(issue?.issueUrl ?? null);
      setDialogOpen(true);
    },
    [address]
  );

  const handleClaimOpen = React.useCallback(
    (issue: IssueRow) => {
      if (!address) {
        window.alert("Connect a wallet to submit a claim.");
        return;
      }
      setClaimIssue(issue);
      setClaimOpen(true);
    },
    [address]
  );

  const handlePayOutBountyOpen = React.useCallback((issue: IssueRow) => {
    setPayOutIssue(issue);
    setPayOutOpen(true);
  }, []);

  const filteredIssues = React.useMemo(() => {
    if (!myFundingOnly || !address) return displayedIssues;
    const addr = address.toLowerCase();
    return displayedIssues.filter((issue) => issue.funders?.some((funder) => funder.toLowerCase() === addr));
  }, [displayedIssues, myFundingOnly, address]);

  const showUsdc = React.useMemo(() => {
    return filteredIssues.some((issue) => {
      const usdc = usdcAddressForChainId(issue.chainId);
      if (!usdc) return false;
      const asset = issue.assets.find((a) => a.token.toLowerCase() === usdc.toLowerCase());
      if (!asset) return false;
      try {
        return BigInt(asset.escrowedWei) > 0n;
      } catch {
        return false;
      }
    });
  }, [filteredIssues]);

  const ownersWithPayouts = React.useMemo(() => {
    const owners = new Set<string>();
    displayedIssues.forEach((issue) => {
      if (issue.owner && issue.counts?.payouts > 0) {
        owners.add(issue.owner.toLowerCase());
      }
    });
    return owners;
  }, [displayedIssues]);

  const columns = React.useMemo(
    () =>
      createIssueColumns({
        onAddFunds: (issue) => handleAddFunds(issue),
        onClaim: handleClaimOpen,
        onPayOutBounty: handlePayOutBountyOpen,
        showUsdc,
        ownersWithPayouts,
        walletAddress: address,
        githubLogin: user?.login ?? null,
      }),
    [handleAddFunds, handleClaimOpen, handlePayOutBountyOpen, showUsdc, ownersWithPayouts, address, user?.login]
  );

  const handleDialogOpenChange = React.useCallback(
    (next: boolean) => {
      if (next && !address) return;
      setDialogOpen(next);
      if (!next) setPrefillIssueUrl(null);
    },
    [address]
  );

  const githubMatch = React.useMemo(() => {
    if (!address || !user) return false;
    if (ensGithub === "*") return true;
    const record = normalizeGithubUsername(ensGithub);
    if (!record) return false;
    return record.toLowerCase() === user.login.toLowerCase();
  }, [address, user, ensGithub]);

  const hasNetworkSwitch = Boolean(mainnetWebOrigin || sepoliaWebOrigin);

  const switchNetwork = React.useCallback(
    (targetOrigin: string, preservePath = true) => {
      const origin = targetOrigin.replace(/\/+$/, "");
      const path = preservePath ? `${window.location.pathname}${window.location.search}${window.location.hash}` : "";
      window.location.href = `${origin}${path}`;
    },
    []
  );

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full flex-col gap-8 px-6 py-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            {/* <h1 className="text-3xl font-semibold tracking-tight">Issues with bounties</h1> */}
	            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
	              <Button size="sm" onClick={() => handleAddFunds()} disabled={!address}>
	                Fund any Github issue.
		              </Button>
		              <p className="text-sm text-muted-foreground">
		                And claim rewards for solving it. AI Agents start at{" "}
		                <a
		                  href="https://github.com/seichris/clankergigs/blob/main/AGENTS.md"
		                  target="_blank"
	                  rel="noopener noreferrer"
	                  className="underline hover:text-foreground"
	                >
		                  AGENTS.md
		                </a>
		                .
		              </p>
		            </div>
		          </div>
          <div className="flex items-center gap-3">
            {hasNetworkSwitch ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    {chainLabel(chainId)}
                    <ChevronDown className="ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {mainnetWebOrigin ? (
                    <DropdownMenuItem disabled={chainId === 1} onClick={() => switchNetwork(mainnetWebOrigin)}>
                      {chainLabel(1)}
                    </DropdownMenuItem>
                  ) : null}
                  {sepoliaWebOrigin ? (
                    <DropdownMenuItem disabled={chainId === 11155111} onClick={() => switchNetwork(sepoliaWebOrigin)}>
                      {chainLabel(11155111)}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Badge variant="outline" title="Configured by NEXT_PUBLIC_CHAIN_ID">
                {chainLabel(chainId)}
              </Badge>
            )}
            {!address ? (
              <Button
                variant="outline"
                onClick={() => connect().catch((err) => window.alert(err?.message ?? String(err)))}
                disabled={!hasProvider}
              >
                {hasProvider ? "Connect wallet" : "No wallet detected"}
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => navigator.clipboard.writeText(address)}>
                  <Avatar className="h-5 w-5">
                    {ensAvatarUrl ? <AvatarImage src={ensAvatarUrl} alt={ensName || "ENS avatar"} /> : null}
                    <AvatarFallback style={addressGradientStyle(address)} />
                  </Avatar>
                  {ensName || shortAddress(address)}
                </Button>
                {githubMatch ? (
                  <Badge
                    variant="outline"
                    title="ENS text record com.github matches your connected GitHub account."
                  >
                    Verified GitHub on ENS
                  </Badge>
                ) : null}
              </div>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                  <Avatar>
                    <AvatarImage src={user?.avatar_url || ""} alt={user?.login || "GitHub user"} />
                    <AvatarFallback>
                      {/* GitHub mark (black in light mode, white in dark mode). */}
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 16 16"
                        className="h-4 w-4 text-black dark:text-white"
                        fill="currentColor"
                      >
                        <path d="M8 0C3.58 0 0 3.65 0 8.16c0 3.61 2.29 6.67 5.47 7.75.4.08.55-.18.55-.39 0-.19-.01-.82-.01-1.49-2.01.45-2.53-.5-2.69-.96-.09-.23-.48-.96-.82-1.16-.28-.15-.68-.52-.01-.53.63-.01 1.08.6 1.23.85.72 1.24 1.87.89 2.33.68.07-.53.28-.89.51-1.09-1.78-.21-3.64-.92-3.64-4.1 0-.91.32-1.65.85-2.23-.09-.21-.37-1.06.08-2.2 0 0 .69-.23 2.26.85.66-.19 1.36-.28 2.06-.28.7 0 1.4.1 2.06.28 1.57-1.08 2.26-.85 2.26-.85.45 1.14.16 1.99.08 2.2.53.58.85 1.32.85 2.23 0 3.19-1.87 3.89-3.65 4.1.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.47.55.39C13.71 14.83 16 11.77 16 8.16 16 3.65 12.42 0 8 0Z" />
                      </svg>
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {user ? (
                  <>
                    <DropdownMenuItem disabled>Signed in as {user.login}</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => logout()}>Logout GitHub</DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem onClick={() => login()}>Connect GitHub</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon"
              className="hover:bg-transparent active:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Toggle dark mode"
              disabled={!mounted}
            >
              {mounted && theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </header>

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">Loading issues…</div>
        ) : (
          <IssuesDataTable
            columns={columns}
            data={filteredIssues}
            showUsdc={showUsdc}
            walletAddress={address}
            myFundingOnly={myFundingOnly}
            setMyFundingOnly={setMyFundingOnly}
            githubUser={user}
            onClaim={handleClaimOpen}
          />
        )}
      </div>

      <FundIssueDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        walletAddress={address}
        defaultIssueUrl={prefillIssueUrl}
        onFunded={() => fetchIssues()}
      />

      <ClaimBountyDialog
        open={claimOpen}
        onOpenChange={(next) => {
          setClaimOpen(next);
          if (!next) setClaimIssue(null);
        }}
        walletAddress={address}
        bountyId={claimIssue?.bountyId ?? null}
        issueUrl={claimIssue?.issueUrl ?? null}
        apiUrl={apiUrl}
        githubUser={user}
        onGithubLogin={login}
        onClaimed={() => fetchIssues()}
      />

      <PayOutBountyDialog
        open={payOutOpen}
        onOpenChange={(next) => {
          setPayOutOpen(next);
          if (!next) setPayOutIssue(null);
        }}
        walletAddress={address}
        onWalletConnect={connect}
        bountyId={payOutIssue?.bountyId ?? null}
        issueUrl={payOutIssue?.issueUrl ?? null}
        apiUrl={apiUrl}
        githubUser={user}
        onGithubLogin={login}
        isFunder={Boolean(
          address &&
            payOutIssue?.funders?.some((funder) => funder.toLowerCase() === address.toLowerCase())
        )}
        escrowedByToken={
          payOutIssue
            ? payOutIssue.assets.reduce<Record<string, string>>((acc, asset) => {
                acc[asset.token.toLowerCase()] = asset.escrowedWei;
                return acc;
              }, {})
            : undefined
        }
        onPayouted={() => fetchIssues()}
      />
    </main>
  );
}
