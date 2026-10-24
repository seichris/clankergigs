"use client";

import * as React from "react";
import { NetworkSelector, useNetwork } from "@/components/network-provider";
import { networkQuery, isActiveNetwork, type Deployment } from "@/lib/networks";
import { Moon, Sun } from "lucide-react";

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

function errorMessage(err: unknown) {
  if (typeof err === "object" && err !== null && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg.length > 0) return msg;
  }
  return String(err);
}

export default function Home() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787";
  const { network } = useNetwork();
  const { address, hasProvider, connect } = useWallet();
  const { user, login, logout } = useGithubUser(apiUrl);
  const { theme, setTheme, mounted } = useTheme();
  const { name: ensName } = useEnsPrimaryName(address);
  const { avatarUrl: ensAvatarUrl } = useEnsAvatarUrl(ensName);
  const { value: ensGithub } = useEnsTextRecord(ensName && user ? ensName : null, "com.github");

  const [issuesNetwork, setIssuesNetwork] = React.useState<Deployment | null>(null);
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

  const displayedIssues = issuesNetwork === network ? issues : [];
  const requestVersion = React.useRef(0);
  const fetchIssues = React.useCallback(async () => {
    if (network && !isActiveNetwork(network)) return;
    const version = ++requestVersion.current;
    setIssues([]);
    if (!network) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/issues?include=github&${networkQuery(network)}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load issues (${res.status})`);
      const json = (await res.json()) as { issues?: IssueRow[] };
      if (version === requestVersion.current && isActiveNetwork(network)) {
        setIssuesNetwork(network);
        setIssues(json?.issues ?? []);
      }
    } catch (err: unknown) {
      if (version === requestVersion.current && isActiveNetwork(network)) setError(errorMessage(err));
    } finally {
      if (version === requestVersion.current && isActiveNetwork(network)) setLoading(false);
    }
  }, [apiUrl, network]);

  React.useEffect(() => {
    setDialogOpen(false);
    setClaimOpen(false);
    setPayOutOpen(false);
    setClaimIssue(null);
    setPayOutIssue(null);
    void fetchIssues();
    return () => { requestVersion.current++; };
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

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full flex-col gap-8 px-6 py-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            {/* <h1 className="text-3xl font-semibold tracking-tight">Issues with bounties</h1> */}
	            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
	              <Button size="sm" onClick={() => handleAddFunds()} disabled={!address || !network}>
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
            <NetworkSelector />
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
        open={dialogOpen && Boolean(network)}
        onOpenChange={handleDialogOpenChange}
        walletAddress={address}
        defaultIssueUrl={prefillIssueUrl}
        onFunded={() => fetchIssues()}
      />

      <ClaimBountyDialog
        open={claimOpen && issuesNetwork === network}
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
        open={payOutOpen && issuesNetwork === network}
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
