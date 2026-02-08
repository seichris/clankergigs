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
import { PayoutDialog } from "@/components/payout-dialog";
import { AdminPayoutDialog } from "@/components/admin-payout-dialog";
import { TreasuryDialog } from "@/components/treasury-dialog";
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
  if (chainId === 1) return "Ethereum + Arc";
  if (chainId === 11155111) return "Sepolia + Arc";
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

export default function Home() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787";
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "31337");
  const mainnetWebOrigin = (process.env.NEXT_PUBLIC_WEB_ORIGIN_ETHEREUM_MAINNET || "").trim();
  const sepoliaWebOrigin = (process.env.NEXT_PUBLIC_WEB_ORIGIN_ETHEREUM_SEPOLIA || "").trim();
  const suiWebOrigin = (process.env.NEXT_PUBLIC_WEB_ORIGIN_SUI || "").trim();
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
  const [treasuryOpen, setTreasuryOpen] = React.useState(false);
  const [treasuryIssue, setTreasuryIssue] = React.useState<IssueRow | null>(null);
  const [claimIssue, setClaimIssue] = React.useState<IssueRow | null>(null);
  const [claimOpen, setClaimOpen] = React.useState(false);
  const [payoutIssue, setPayoutIssue] = React.useState<IssueRow | null>(null);
  const [payoutOpen, setPayoutOpen] = React.useState(false);
  const [payoutMode, setPayoutMode] = React.useState<"funder" | "dao">("funder");
  const [adminPayoutIssue, setAdminPayoutIssue] = React.useState<IssueRow | null>(null);
  const [adminPayoutOpen, setAdminPayoutOpen] = React.useState(false);
  const [adminBountyIds, setAdminBountyIds] = React.useState<Set<string>>(new Set());
  const [daoAddress, setDaoAddress] = React.useState<string | null>(null);

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
    let active = true;
    fetch(`${apiUrl}/contract`)
      .then(async (res) => {
        if (!res.ok) return null;
        const json = (await res.json()) as { dao?: string };
        return json?.dao ?? null;
      })
      .then((dao) => {
        if (!active) return;
        setDaoAddress(dao);
      })
      .catch(() => {
        if (!active) return;
        setDaoAddress(null);
      });
    return () => {
      active = false;
    };
  }, [apiUrl]);

  React.useEffect(() => {
    if (!address) setMyFundingOnly(false);
  }, [address]);

  React.useEffect(() => {
    if (!user || issues.length === 0) {
      setAdminBountyIds(new Set());
      return;
    }
    let active = true;
    Promise.all(
      issues.map((issue) =>
        fetch(`${apiUrl}/github/admin?bountyId=${encodeURIComponent(issue.bountyId)}`, { credentials: "include" })
          .then(async (res) => {
            if (!res.ok) return false;
            const json = (await res.json()) as { isAdmin?: boolean };
            return Boolean(json?.isAdmin);
          })
          .catch(() => false)
      )
    )
      .then((results) => {
        if (!active) return;
        const next = new Set<string>();
        issues.forEach((issue, idx) => {
          if (results[idx]) next.add(issue.bountyId);
        });
        setAdminBountyIds(next);
      })
      .catch(() => {
        if (!active) return;
        setAdminBountyIds(new Set());
      });
    return () => {
      active = false;
    };
  }, [apiUrl, issues, user?.login]);

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

  const handleTreasury = React.useCallback(
    (issue: IssueRow) => {
      setTreasuryIssue(issue);
      setTreasuryOpen(true);
    },
    []
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

  const handlePayoutOpen = React.useCallback(
    (issue: IssueRow, mode: "funder" | "dao") => {
      if (!address) {
        window.alert("Connect a wallet to submit payouts.");
        return;
      }
      setPayoutIssue(issue);
      setPayoutMode(mode);
      setPayoutOpen(true);
    },
    [address]
  );

  const handleAdminPayoutOpen = React.useCallback(
    (issue: IssueRow) => {
      if (!address) {
        window.alert("Connect a wallet to submit payouts.");
        return;
      }
      setAdminPayoutIssue(issue);
      setAdminPayoutOpen(true);
    },
    [address]
  );

  const filteredIssues = React.useMemo(() => {
    if (!myFundingOnly || !address) return issues;
    const addr = address.toLowerCase();
    return issues.filter((issue) => issue.funders?.some((funder) => funder.toLowerCase() === addr));
  }, [issues, myFundingOnly, address]);

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
    issues.forEach((issue) => {
      if (issue.owner && issue.counts?.payouts > 0) {
        owners.add(issue.owner.toLowerCase());
      }
    });
    return owners;
  }, [issues]);

  const columns = React.useMemo(
    () =>
      createIssueColumns({
        onAddFunds: (issue) => handleAddFunds(issue),
        onClaim: handleClaimOpen,
        onPayout: handlePayoutOpen,
        onAdminPayout: handleAdminPayoutOpen,
        showUsdc,
        ownersWithPayouts,
        walletAddress: address,
        adminBountyIds,
        daoAddress,
      }),
    [handleAddFunds, handleClaimOpen, handlePayoutOpen, handleAdminPayoutOpen, showUsdc, ownersWithPayouts, address, adminBountyIds, daoAddress]
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

  const hasNetworkSwitch = Boolean(mainnetWebOrigin || sepoliaWebOrigin || suiWebOrigin);

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
            <p className="text-sm text-muted-foreground">
              Fund any Github issue. Claim rewards for solving it. Built for Humans and AI Agents like OpenClaw (start at <a href="https://github.com/seichris/gh-bounties/blob/main/AGENTS.md" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">AGENTS.md</a>).
            </p>
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
                  {suiWebOrigin ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => switchNetwork(suiWebOrigin, false)}>Sui</DropdownMenuItem>
                    </>
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
                    <AvatarFallback>{user?.login?.slice(0, 2).toUpperCase() || "GH"}</AvatarFallback>
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
            onAddIssue={() => handleAddFunds()}
            onClaim={handleClaimOpen}
            onPayout={handlePayoutOpen}
            onAdminPayout={handleAdminPayoutOpen}
            onTreasury={handleTreasury}
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

      <PayoutDialog
        open={payoutOpen}
        onOpenChange={(next) => {
          setPayoutOpen(next);
          if (!next) setPayoutIssue(null);
        }}
        walletAddress={address}
        bountyId={payoutIssue?.bountyId ?? null}
        issueUrl={payoutIssue?.issueUrl ?? null}
        apiUrl={apiUrl}
        mode={payoutMode}
        escrowedByToken={
          payoutIssue
            ? payoutIssue.assets.reduce<Record<string, string>>((acc, asset) => {
                acc[asset.token.toLowerCase()] = asset.escrowedWei;
                return acc;
              }, {})
            : undefined
        }
        onPayouted={() => fetchIssues()}
      />

      <AdminPayoutDialog
        open={adminPayoutOpen}
        onOpenChange={(next) => {
          setAdminPayoutOpen(next);
          if (!next) setAdminPayoutIssue(null);
        }}
        walletAddress={address}
        bountyId={adminPayoutIssue?.bountyId ?? null}
        issueUrl={adminPayoutIssue?.issueUrl ?? null}
        apiUrl={apiUrl}
        githubUser={user}
        onGithubLogin={login}
        escrowedByToken={
          adminPayoutIssue
            ? adminPayoutIssue.assets.reduce<Record<string, string>>((acc, asset) => {
                acc[asset.token.toLowerCase()] = asset.escrowedWei;
                return acc;
              }, {})
            : undefined
        }
        onPayouted={() => fetchIssues()}
      />

      <TreasuryDialog
        open={treasuryOpen}
        onOpenChange={(next) => {
          setTreasuryOpen(next);
          if (!next) setTreasuryIssue(null);
        }}
        apiUrl={apiUrl}
        bountyId={treasuryIssue?.bountyId ?? null}
        issueUrl={treasuryIssue?.issueUrl ?? null}
        walletAddress={address}
        githubUser={user}
        onGithubLogin={login}
      />
    </main>
  );
}
