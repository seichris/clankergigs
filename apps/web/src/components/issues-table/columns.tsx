"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { formatUnits } from "viem";
import { ArrowUpDown, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usdcAddressForChainId } from "@gh-bounties/shared";

import type { GithubIssueLabel, IssueRow, UnlockSchedule } from "./types";

const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function shortHex(value: string | null | undefined, chars = 6) {
  if (!value) return "-";
  if (value.length <= chars * 2 + 2) return value;
  return `${value.slice(0, chars + 2)}…${value.slice(-chars)}`;
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
  const days = schedule?.days ?? [];
  const maxDay = days.length ? Math.max(1, ...days.map((d) => d.day)) : 0;
  const total = schedule?.totalEscrowedWei ? BigInt(schedule.totalEscrowedWei) : 0n;

  return (
    <div className="flex-1">
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        {days.map((entry) => {
          let opacity = 0.7;
          if (total > 0n) {
            try {
              const ratio = Number((BigInt(entry.amountWei) * 1000n) / total) / 1000;
              opacity = Math.max(0.3, Math.min(1, 0.4 + ratio));
            } catch {
              opacity = 0.7;
            }
          }
          return <span key={entry.day} className="h-full flex-1 bg-foreground" style={{ opacity }} />;
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>0d</span>
        <span>{maxDay}d</span>
      </div>
    </div>
  );
}

function assetLine(
  label: string,
  totals: IssueRow["assets"][number] | undefined,
  decimals: number,
  schedule: UnlockSchedule | null
) {
  const amount = totals ? truncateDecimals(formatAssetValue(totals.escrowedWei, decimals), 4) : "0";
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground tabular-nums">{amount}</span>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <UnlockBar schedule={schedule} />
    </div>
  );
}

function statusVariant(status: string) {
  const normalized = status.toUpperCase();
  if (normalized === "OPEN") return "success";
  if (normalized === "IMPLEMENTED") return "secondary";
  if (normalized === "CLOSED") return "outline";
  return "default";
}

export function createIssueColumns(options: {
  onAddFunds: (issue: IssueRow) => void;
  onClaim: (issue: IssueRow) => void;
  onPayout: (issue: IssueRow, mode: "funder" | "dao") => void;
  onAdminPayout: (issue: IssueRow) => void;
  showUsdc: boolean;
  ownersWithPayouts: Set<string>;
  walletAddress?: string | null;
  adminBountyIds?: Set<string>;
  daoAddress?: string | null;
})
  : ColumnDef<IssueRow>[] {
  const adminBountyIds = options.adminBountyIds ?? new Set<string>();
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
      accessorKey: "status",
      header: "Status",
      filterFn: (row, id, values) => {
        if (!values) return true;
        const list = Array.isArray(values) ? values : [values];
        if (list.length === 0) return true;
        return list.includes(row.getValue(id));
      },
      cell: ({ row }) => (
        <Badge variant={statusVariant(row.original.status) as any}>{row.original.status}</Badge>
      ),
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
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          In active bounty
          <ArrowUpDown className="ml-2 h-3.5 w-3.5 text-muted-foreground" />
        </Button>
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
      cell: ({ row }) => (
        <div className="text-xs text-muted-foreground">
          {row.original.counts.linkedPrs ?? 0}
        </div>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const issue = row.original;
        const wallet = options.walletAddress?.toLowerCase() || "";
        const isRepoAdmin = adminBountyIds.has(issue.bountyId);
        const isFunder = Boolean(
          wallet && issue.funders?.some((funder) => funder.toLowerCase() === wallet)
        );
        const daoAddress = options.daoAddress?.toLowerCase() || "";
        const isDao = Boolean(
          wallet && daoAddress && daoAddress !== ZERO_ADDRESS && wallet === daoAddress
        );
        const canPayout = isRepoAdmin || isFunder || isDao;

        return (
          <div className="flex flex-col gap-2">
            <Button size="sm" onClick={() => options.onAddFunds(issue)}>
              Fund bounty
            </Button>
            <Button size="sm" variant="outline" onClick={() => options.onClaim(issue)}>
              Submit claim
            </Button>
            {canPayout ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  if (isRepoAdmin) {
                    options.onAdminPayout(issue);
                  } else if (isDao) {
                    options.onPayout(issue, "dao");
                  } else {
                    options.onPayout(issue, "funder");
                  }
                }}
              >
                Pay out bounty
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ];
}
