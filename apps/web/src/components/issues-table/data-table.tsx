"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type ExpandedState,
  type VisibilityState,
  type SortingState,
} from "@tanstack/react-table";
import { formatUnits, type Address } from "viem";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usdcAddressForChainId } from "@gh-bounties/shared";

import { DataTableToolbar } from "./toolbar";
import type { ActivityDay, ActivityEvent, IssueRow } from "./types";
import type { GithubUser } from "@/lib/hooks/useGithubUser";

const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";

function shortHex(value: string, chars = 8) {
  if (!value) return "-";
  if (value.length <= chars * 2 + 2) return value;
  return `${value.slice(0, chars + 2)}…${value.slice(-chars)}`;
}

function formatAmount(value: string, decimals: number) {
  try {
    return formatUnits(BigInt(value), decimals);
  } catch {
    return value;
  }
}

function getTokenMeta(token: string, chainId: number) {
  if (token.toLowerCase() === ETH_ADDRESS.toLowerCase()) return { label: "ETH", decimals: 18 };
  const usdc = usdcAddressForChainId(chainId);
  if (usdc && token.toLowerCase() === usdc.toLowerCase()) return { label: "USDC", decimals: 6 };
  return { label: shortHex(token), decimals: 18 };
}

function ExpandedIssueRow({
  issue,
  showUsdc,
  walletAddress,
  onClaim,
  onPayout,
  onAdminPayout,
  onTreasury,
}: {
  issue: IssueRow;
  showUsdc: boolean;
  walletAddress: Address | null;
  onClaim: (issue: IssueRow) => void;
  onPayout: (issue: IssueRow, mode: "funder" | "dao") => void;
  onAdminPayout: (issue: IssueRow) => void;
  onTreasury?: (issue: IssueRow) => void;
}) {
  const usdc = usdcAddressForChainId(issue.chainId);
  const assets = showUsdc || !usdc
    ? issue.assets
    : issue.assets.filter((asset) => asset.token.toLowerCase() !== usdc.toLowerCase());
  const repo = issue.github?.repo;
  const homepage = repo?.homepage
    ? repo.homepage.startsWith("http")
      ? repo.homepage
      : `https://${repo.homepage}`
    : null;
  const timeline = issue.activityTimeline;
  const startDate = timeline ? new Date(timeline.startDate) : new Date(issue.createdAt);
  const endDate = timeline ? new Date(timeline.endDate) : new Date();
  const days = timeline?.days ?? [];
  const linkedPrs = issue.linkedPullRequests ?? [];

  function formatDate(date: Date) {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function formatRelativeDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    const diffMs = date.getTime() - Date.now();
    const diffSeconds = Math.round(diffMs / 1000);
    const divisions: Array<[number, Intl.RelativeTimeFormatUnit]> = [
      [60, "second"],
      [60, "minute"],
      [24, "hour"],
      [7, "day"],
      [4.345, "week"],
      [12, "month"],
      [Number.POSITIVE_INFINITY, "year"],
    ];
    let unit: Intl.RelativeTimeFormatUnit = "second";
    let amount = diffSeconds;
    for (const [div, nextUnit] of divisions) {
      if (Math.abs(amount) < div) {
        unit = nextUnit;
        break;
      }
      amount = Math.round(amount / div);
      unit = nextUnit;
    }
    const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
    return rtf.format(amount, unit);
  }

  function activityColor(type: ActivityEvent["type"]) {
    switch (type) {
      case "funding":
        return "bg-emerald-500";
      case "claim":
        return "bg-amber-500";
      case "payout":
        return "bg-sky-500";
      case "refund":
        return "bg-rose-500";
      case "linked_pr":
        return "bg-indigo-500";
      default:
        return "bg-foreground";
    }
  }

  function sortedDayEvents(day: ActivityDay) {
    return [...day.events].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }
  return (
    <div className="grid gap-4 rounded-md bg-muted/40 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs uppercase text-muted-foreground">Identifiers</span>
        <span className="font-mono text-xs">repoHash: {issue.repoHash}</span>
        <span className="font-mono text-xs">bountyId: {issue.bountyId}</span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <div className="space-y-2">
          <div className="text-xs uppercase text-muted-foreground">Issue</div>
          <div className="break-all text-xs">{issue.issueUrl}</div>
          {issue.github?.title ? <div className="font-medium">{issue.github.title}</div> : null}
          {issue.github?.state ? (
            <Badge variant="outline" className="uppercase">
              {issue.github.state}
            </Badge>
          ) : null}
          {issue.github?.labels?.length ? (
            <div className="flex flex-wrap gap-1">
              {issue.github.labels.map((label) => (
                <span
                  key={label.name}
                  className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide"
                  style={{ borderColor: `#${label.color}` }}
                >
                  {label.name}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="space-y-2">
          <div className="text-xs uppercase text-muted-foreground">Assets</div>
          {assets.length ? (
            <div className="space-y-1 text-xs text-muted-foreground">
              {assets.map((asset) => {
                const meta = getTokenMeta(asset.token, issue.chainId);
                return (
                  <div key={asset.token}>
                    {meta.label}: {formatAmount(asset.fundedWei, meta.decimals)} funded /{" "}
                    {formatAmount(asset.escrowedWei, meta.decimals)} in active bounty /{" "}
                    {formatAmount(asset.paidWei, meta.decimals)} paid
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">No assets recorded.</div>
          )}
        </div>
        <div className="space-y-2 md:col-span-2">
          <div className="text-xs uppercase text-muted-foreground">Repository</div>
          {repo?.description ? (
            <div className="text-sm">{repo.description}</div>
          ) : (
            <div className="text-xs text-muted-foreground">No description available.</div>
          )}
          {homepage ? (
            <div className="text-xs text-muted-foreground">
              Website:{" "}
              <a href={homepage} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                {repo?.homepage}
              </a>
            </div>
          ) : null}
        </div>
        <div className="space-y-2 md:col-span-2">
          <div className="text-xs uppercase text-muted-foreground">Last updated</div>
          <div className="text-xs text-muted-foreground">
            {formatRelativeDate(issue.updatedAt)} · {new Date(issue.updatedAt).toLocaleString()}
          </div>
        </div>
        <div className="space-y-2 md:col-span-2">
          <div className="text-xs uppercase text-muted-foreground">Linked pull requests</div>
          {linkedPrs.length ? (
            <div className="grid gap-1 text-xs text-muted-foreground">
              {linkedPrs.map((pr) => (
                <a key={pr.prUrl} href={pr.prUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                  {pr.prUrl}
                </a>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">No linked PRs yet.</div>
          )}
        </div>
        <div className="space-y-3 md:col-span-2">
          <div className="text-xs uppercase text-muted-foreground">Activity</div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>Fundings: {issue.counts.fundings}</span>
            <span>Claims: {issue.counts.claims}</span>
            <span>Payouts: {issue.counts.payouts}</span>
            <span>Refunds: {issue.counts.refunds}</span>
            <span>Linked PRs: {issue.counts.linkedPrs ?? 0}</span>
          </div>
          <div className="space-y-2">
            <div className="flex h-2 overflow-hidden rounded-full bg-muted">
              {days
                .flatMap((day) => sortedDayEvents(day).map((event) => ({ day: day.day, event })))
                .sort((a, b) => {
                  const aTime = new Date(a.event.timestamp).getTime();
                  const bTime = new Date(b.event.timestamp).getTime();
                  if (aTime !== bTime) return aTime - bTime;
                  return a.day - b.day;
                })
                .map(({ event }, idx) => (
                  <span
                    key={`${event.timestamp}-${event.type}-${idx}`}
                    className={`h-full flex-1 ${activityColor(event.type)}`}
                  />
                ))}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{formatDate(startDate)}</span>
              <span>{formatDate(endDate)}</span>
            </div>
          </div>
        </div>
        <div className="space-y-2 md:col-span-2">
          <div className="text-xs uppercase text-muted-foreground">Claim bounty</div>
          {walletAddress ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" onClick={() => onClaim(issue)}>
                Submit claim
              </Button>
              <span className="text-xs text-muted-foreground">Use your PR URL to claim this bounty.</span>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">Connect a wallet to submit a claim.</div>
          )}
        </div>
        <div className="space-y-2 md:col-span-2">
          <div className="text-xs uppercase text-muted-foreground">Payouts</div>
          {walletAddress ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => onAdminPayout(issue)}>
                Admin payout
              </Button>
              {onTreasury ? (
                <Button variant="outline" size="sm" onClick={() => onTreasury(issue)}>
                  Treasury
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => onPayout(issue, "funder")}>
                Funder payout
              </Button>
              <Button variant="outline" size="sm" onClick={() => onPayout(issue, "dao")}>
                DAO payout
              </Button>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">Connect a wallet to submit payouts.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function IssuesDataTable({
  columns,
  data,
  showUsdc,
  walletAddress,
  myFundingOnly,
  setMyFundingOnly,
  githubUser,
  onAddIssue,
  onClaim,
  onPayout,
  onAdminPayout,
  onTreasury,
}: {
  columns: ColumnDef<IssueRow>[];
  data: IssueRow[];
  showUsdc: boolean;
  walletAddress: Address | null;
  myFundingOnly: boolean;
  setMyFundingOnly: (next: boolean) => void;
  githubUser: GithubUser | null;
  onAddIssue: () => void;
  onClaim: (issue: IssueRow) => void;
  onPayout: (issue: IssueRow, mode: "funder" | "dao") => void;
  onAdminPayout: (issue: IssueRow) => void;
  onTreasury?: (issue: IssueRow) => void;
}) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [expanded, setExpanded] = React.useState<ExpandedState>({});
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({
    labels: false,
    owner: false,
  });

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      expanded,
      columnVisibility,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onExpandedChange: setExpanded,
    onColumnVisibilityChange: setColumnVisibility,
    globalFilterFn: (row, _columnId, filterValue) => {
      const query = String(filterValue || "").toLowerCase().trim();
      if (!query) return true;
      const issue = row.original as IssueRow;
      const haystack = [
        issue.issueUrl,
        issue.owner,
        issue.repo,
        issue.issueNumber ? String(issue.issueNumber) : "",
        issue.status,
        issue.repoHash,
        issue.bountyId,
        issue.github?.title ?? "",
        issue.github?.state ?? "",
        issue.github?.labels?.map((label) => label.name).join(" ") ?? "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getRowCanExpand: () => true,
  });

  const handleRowClick = React.useCallback((event: React.MouseEvent<HTMLTableRowElement>, rowId: string) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("button, a, input, select, textarea, [role='menuitem'], [data-no-row-toggle]")) return;
    table.getRow(rowId).toggleExpanded();
  }, [table]);

  return (
    <div className="space-y-4">
      <DataTableToolbar
        table={table}
        globalFilter={globalFilter}
        setGlobalFilter={setGlobalFilter}
        walletAddress={walletAddress}
        myFundingOnly={myFundingOnly}
        setMyFundingOnly={setMyFundingOnly}
        githubUser={githubUser}
        onAddIssue={onAddIssue}
      />
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <React.Fragment key={row.id}>
                  <TableRow
                    onClick={(event) => handleRowClick(event, row.id)}
                    className="cursor-pointer"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                    ))}
                  </TableRow>
                  {row.getIsExpanded() ? (
                    <TableRow>
                      <TableCell colSpan={columns.length}>
                        <ExpandedIssueRow
                          issue={row.original}
                          showUsdc={showUsdc}
                          walletAddress={walletAddress}
                          onClaim={onClaim}
                          onPayout={onPayout}
                          onAdminPayout={onAdminPayout}
                          onTreasury={onTreasury}
                        />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </React.Fragment>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-sm text-muted-foreground">
                  No issues found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {table.getFilteredRowModel().rows.length} issue(s)
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            Previous
          </Button>
          <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
