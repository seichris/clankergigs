"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { formatUnits } from "viem";
import type { Address } from "viem";
import { ArrowUpDown, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usdcAddressForChainId } from "@gh-bounties/shared";

import type { GithubIssueLabel, IssueRow, UnlockSchedule } from "./types";

const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";

function prNumberFromUrl(url: string): number | null {
  // Expected: https://github.com/<owner>/<repo>/pull/<n>
  const m = url.match(/\/pull\/(\d+)(?:\/|$|\?)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function labelTextColor(hex: string) {
  const sanitized = hex.replace("#", "");
  if (sanitized.length !== 6) return "#111111";
  const r = parseInt(sanitized.slice(0, 2), 16);
  const g = parseInt(sanitized.slice(2, 4), 16);
  const b = parseInt(sanitized.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#111111" : "#ffffff";
}

function labelBadge(label: GithubIssueLabel) {
  const bg = `#${label.color}`;
  return (
    <span
      key={label.name}
      className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
      style={{ backgroundColor: bg, color: labelTextColor(label.color) }}
    >
      {label.name}
    </span>
  );
}

function formatAssetValue(value: string, decimals: number) {
  try {
    return formatUnits(BigInt(value), decimals);
  } catch {
    return "0";
  }
}

function truncateDecimals(value: string, maxDecimals: number) {
  const dot = value.indexOf(".");
  if (dot === -1) return value;
  const decimals = value.slice(dot + 1);
  if (decimals.length <= maxDecimals) return value;
  return `${value.slice(0, dot)}.${decimals.slice(0, maxDecimals)}`;
}

function assetTotals(issue: IssueRow, token: string) {
  return issue.assets.find((asset) => asset.token.toLowerCase() === token.toLowerCase());
}

function escrowedForToken(issue: IssueRow, token: string) {
  const totals = assetTotals(issue, token);
  if (!totals) return 0n;
  try {
    return BigInt(totals.escrowedWei);
  } catch {
    return 0n;
  }
}

function decimalsForToken(issue: IssueRow, token: string) {
  if (token.toLowerCase() === ETH_ADDRESS.toLowerCase()) return 18;
  const usdc = usdcAddressForChainId(issue.chainId);
  if (usdc && token.toLowerCase() === usdc.toLowerCase()) return 6;
  return 18;
}

function normalizeTo18Decimals(amount: bigint, decimals: number) {
  if (decimals === 18) return amount;
  if (decimals > 18) return amount / (10n ** BigInt(decimals - 18));
  return amount * (10n ** BigInt(18 - decimals));
}

function totalEscrowedForSort(issue: IssueRow) {
  let total = 0n;
  for (const asset of issue.assets) {
    try {
      const raw = BigInt(asset.escrowedWei);
      total += normalizeTo18Decimals(raw, decimalsForToken(issue, asset.token));
    } catch {
      // Ignore malformed amounts to keep sorting resilient.
    }
  }
  return total;
}

function UnlockBar({ schedule }: { schedule: UnlockSchedule | null }) {
  const entries = schedule?.days ?? [];
  const total = schedule?.totalEscrowedWei ? BigInt(schedule.totalEscrowedWei) : 0n;
  const maxDay = entries.reduce((m, e) => (e.day > m ? e.day : m), 0);

  // Render a per-day strip (including gap-days) so label positions are meaningful (1d, 3d, 14d, ...).
  const byDay: bigint[] = Array.from({ length: maxDay + 1 }, () => 0n);
  for (const entry of entries) {
    if (entry.day < 0 || entry.day > maxDay) continue;
    try {
      byDay[entry.day] += BigInt(entry.amountWei);
    } catch {
      // ignore malformed amounts
    }
  }

  return (
    <div
      className="grid h-2 w-full self-center overflow-hidden rounded-full bg-muted-foreground/20"
      style={{ gridTemplateColumns: `repeat(${byDay.length}, minmax(0, 1fr))` }}
    >
      {byDay.map((amountWei, day) => {
        let opacity = 0.7;
        if (total > 0n) {
          try {
            const ratio = Number((amountWei * 1000n) / total) / 1000;
            // Wider range of grays: small buckets should be noticeably lighter.
            const clamped = Math.max(0, Math.min(1, ratio));
            const scaled = Math.pow(clamped, 1.6); // push small buckets lighter (more contrast)
            opacity = Math.min(1, 0.08 + 0.95 * scaled);
          } catch {
            opacity = 0.7;
          }
        } else {
          opacity = 0;
        }
        // Gap-days should show as the bar background (not a faint segment).
        if (amountWei === 0n) opacity = 0;
        return <span key={day} className="h-full bg-foreground" style={{ opacity }} />;
      })}
    </div>
  );
}

function assetLine(
  label: string,
  totals: IssueRow["assets"][number] | undefined,
  decimals: number,
  _schedule: UnlockSchedule | null
) {
  const amount = totals ? truncateDecimals(formatAssetValue(totals.escrowedWei, decimals), 4) : "0";
  // Timeline temporarily disabled (keep only the headline amount).
  return (
    <div className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="text-xs font-medium tabular-nums">{amount}</span>
      <span className="text-xs font-medium">{label}</span>
    </div>
  );
}

function statusVariant(status: string) {
  const normalized = status.toUpperCase();
  if (normalized === "OPEN") return "success";
  if (normalized === "CLOSED") return "outline";
  return "default";
}

export function createIssueColumns(options: {
  onAddFunds: (issue: IssueRow) => void;
  onClaim: (issue: IssueRow) => void;
  onPayOutBounty: (issue: IssueRow) => void;
  showUsdc: boolean;
  ownersWithPayouts: Set<string>;
  walletAddress: Address | null;
  githubLogin: string | null;
})
  : ColumnDef<IssueRow>[] {
  return [
    {
      accessorKey: "issueUrl",
      header: "Issue",
      cell: ({ row }) => {
        const issue = row.original;
        const repoLabel = issue.owner && issue.repo ? `${issue.owner}/${issue.repo}` : issue.issueUrl;
        const issueNum = issue.issueNumber ? `#${issue.issueNumber}` : "";
        const title = issue.github?.title || `${repoLabel} ${issueNum}`.trim();
        const labels = issue.github?.labels ?? [];
        const link = issue.github?.htmlUrl || issue.issueUrl;
        const showPayoutBadge =
          issue.owner && options.ownersWithPayouts.has(issue.owner.toLowerCase());
        return (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <a href={link} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                {title}
              </a>
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                {repoLabel} {issueNum}
              </span>
              {showPayoutBadge ? (
                <span title="Repo owner previously paid out bounties." aria-label="Repo owner previously paid out bounties.">
                  🛠️
                </span>
              ) : null}
            </div>
            {labels.length ? (
              <div className="flex flex-wrap gap-1">{labels.slice(0, 4).map((label) => labelBadge(label))}</div>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "status",
      accessorFn: (row) => {
        const s = row.github?.state;
        if (!s) return "UNKNOWN";
        if (s.toLowerCase() === "open") return "OPEN";
        if (s.toLowerCase() === "closed") return "CLOSED";
        return s.toUpperCase();
      },
	      header: "Issue Status",
      filterFn: (row, id, values) => {
        if (!values) return true;
        const list = Array.isArray(values) ? values : [values];
        if (list.length === 0) return true;
        return list.includes(row.getValue(id));
      },
      cell: ({ row }) => {
        const status = row.getValue("status") as string;
        return <Badge variant={statusVariant(status) as any}>{status}</Badge>;
      },
    },
    {
      id: "owner",
      accessorFn: (row) => row.owner ?? "",
      filterFn: (row, id, values) => {
        if (!values) return true;
        const list = Array.isArray(values) ? values : [values];
        if (list.length === 0) return true;
        const owner = row.getValue(id) as string;
        return list.includes(owner);
      },
      enableHiding: true,
      cell: () => null,
    },
    {
      id: "labels",
      accessorFn: (row) => row.github?.labels?.map((label) => label.name) ?? [],
      filterFn: (row, id, values) => {
        if (!values) return true;
        const list = Array.isArray(values) ? values : [values];
        if (list.length === 0) return true;
        const labels = row.getValue(id) as string[];
        if (!Array.isArray(labels)) return false;
        return list.some((value) => labels.includes(value));
      },
      cell: ({ row }) => {
        const labels = (row.getValue("labels") as string[]) || [];
        if (labels.length === 0) return null;
        return (
          <div className="flex flex-wrap gap-1">
            {labels.slice(0, 4).map((label) => (
              <span key={label} className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide">
                {label}
              </span>
            ))}
          </div>
        );
      },
      enableHiding: true,
    },
    {
      id: "assets",
      accessorFn: (row) => totalEscrowedForSort(row).toString(),
      enableSorting: true,
      header: ({ column }) => (
        <div className="flex items-center gap-2">
          <span>Current Bounty</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            aria-label="Sort by current bounty"
            title="Sort"
          >
            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </div>
      ),
      sortingFn: (rowA, rowB) => {
        const issueA = rowA.original as IssueRow;
        const issueB = rowB.original as IssueRow;
        const totalA = totalEscrowedForSort(issueA);
        const totalB = totalEscrowedForSort(issueB);
        if (totalA !== totalB) return totalA > totalB ? 1 : -1;

        // Stable tie-breakers for predictable ordering.
        const ethA = escrowedForToken(issueA, ETH_ADDRESS);
        const ethB = escrowedForToken(issueB, ETH_ADDRESS);
        if (ethA !== ethB) return ethA > ethB ? 1 : -1;
        return issueA.bountyId.localeCompare(issueB.bountyId);
      },
      cell: ({ row }) => {
        const issue = row.original;
        const usdc = usdcAddressForChainId(issue.chainId);
        const ethTotals = assetTotals(issue, ETH_ADDRESS);
        const usdcTotals = options.showUsdc && usdc ? assetTotals(issue, usdc) : undefined;
        const ethSchedule =
          issue.unlockSchedule?.find((entry) => entry.token.toLowerCase() === ETH_ADDRESS.toLowerCase()) || null;
        const usdcSchedule =
          options.showUsdc && usdc
            ? issue.unlockSchedule?.find((entry) => entry.token.toLowerCase() === usdc.toLowerCase()) || null
            : null;
        return (
          <div className="flex flex-col gap-3">
            {assetLine("ETH", ethTotals, 18, ethSchedule)}
            {options.showUsdc ? assetLine("USDC", usdcTotals, 6, usdcSchedule) : null}
          </div>
        );
      },
    },
    {
      id: "linkedPrs",
      header: "Linked PRs",
      cell: ({ row }) => {
        const linked = row.original.linkedPullRequests ?? [];
        if (linked.length === 0) {
          return <div className="text-xs text-muted-foreground">0</div>;
        }

        return (
          <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {linked
              .map((pr) => ({ ...pr, num: prNumberFromUrl(pr.prUrl) }))
              .sort((a, b) => {
                // Sort by PR number when possible (stable-ish display); fallback to URL.
                if (a.num != null && b.num != null) return a.num - b.num;
                if (a.num != null) return -1;
                if (b.num != null) return 1;
                return a.prUrl.localeCompare(b.prUrl);
              })
              .map((pr) => {
                const label = pr.num != null ? `#${pr.num}` : pr.prUrl;
                return (
                  <a
                    key={pr.prUrl}
                    href={pr.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    data-no-row-toggle
                    className="transition-colors hover:text-foreground"
                    title={pr.prUrl}
                  >
                    {label}
                  </a>
                );
              })}
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "",
      meta: {
        thClassName: "w-[1%] whitespace-nowrap",
        tdClassName: "w-[1%] whitespace-nowrap",
      },
      cell: ({ row }) => {
        const issue = row.original;
        const isRepoOwner = Boolean(
          issue.owner && options.githubLogin && issue.owner.toLowerCase() === options.githubLogin.toLowerCase()
        );
        const isFunder = Boolean(
          options.walletAddress &&
            issue.funders?.some((funder) => funder.toLowerCase() === options.walletAddress?.toLowerCase())
        );
        const canPayOut = isRepoOwner || isFunder;
        return (
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <Button size="sm" onClick={() => options.onAddFunds(issue)}>
              Fund bounty
            </Button>
            <Button size="sm" variant="outline" onClick={() => options.onClaim(issue)}>
              Submit claim
            </Button>
            {canPayOut ? (
              <Button size="sm" variant="secondary" onClick={() => options.onPayOutBounty(issue)}>
                Payout
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ];
}
