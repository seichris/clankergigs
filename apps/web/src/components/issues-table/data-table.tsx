"use client";

import * as React from "react";
import Link from "next/link";
import { Share2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
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
  githubUser,
  onClaim,
}: {
  issue: IssueRow;
  showUsdc: boolean;
  walletAddress: Address | null;
  githubUser: GithubUser | null;
  onClaim: (issue: IssueRow) => void;
}) {
  const activityBarRef = React.useRef<HTMLDivElement | null>(null);
  const [activityBarWidth, setActivityBarWidth] = React.useState(0);

  const usdc = usdcAddressForChainId(issue.chainId);
  const assets = showUsdc || !usdc
    ? issue.assets
    : issue.assets.filter((asset) => asset.token.toLowerCase() !== usdc.toLowerCase());
  const timeline = issue.activityTimeline;
  const startDate = timeline ? new Date(timeline.startDate) : new Date(issue.createdAt);
  const endDate = timeline ? new Date(timeline.endDate) : new Date();
  const days = timeline?.days ?? [];
  const maxDay = timeline?.maxDay ?? (days.length ? Math.max(...days.map((d) => d.day)) : 0);
  const activityAxisStartUtcMs = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
  const activityDateAtDay = (day: number) => new Date(activityAxisStartUtcMs + day * 24 * 60 * 60 * 1000);
  const unlockSchedules = React.useMemo(() => {
    const list = issue.unlockSchedule ?? [];
    if (showUsdc) return list;
    const usdc = usdcAddressForChainId(issue.chainId);
    if (!usdc) return list;
    return list.filter((entry) => entry.token.toLowerCase() !== usdc.toLowerCase());
  }, [issue.unlockSchedule, issue.chainId, showUsdc]);
  const unlockMaxDay = React.useMemo(() => {
    let max = 0;
    unlockSchedules.forEach((entry) => {
      entry.days.forEach((d) => {
        if (d.day > max) max = d.day;
      });
    });
    return max;
  }, [unlockSchedules]);

  const unlockBarRef = React.useRef<HTMLDivElement | null>(null);
  const [unlockBarWidth, setUnlockBarWidth] = React.useState(0);
  const [lockedHover, setLockedHover] = React.useState<{ token: string; leftPct: number; text: string } | null>(null);
  const unlockAxisStartUtcMs = React.useMemo(() => {
    const now = new Date();
    // Use the current UTC day boundary as "day 0" for lock labels.
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }, []);
  const unlockDateAtDay = React.useCallback(
    (day: number) => new Date(unlockAxisStartUtcMs + day * 24 * 60 * 60 * 1000),
    [unlockAxisStartUtcMs]
  );

  React.useEffect(() => {
    const el = activityBarRef.current;
    if (!el) return;

    const measure = () => setActivityBarWidth(el.getBoundingClientRect().width);
    measure();

    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => {
    const el = unlockBarRef.current;
    if (!el) return;

    const measure = () => setUnlockBarWidth(el.getBoundingClientRect().width);
    measure();

    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  function activityLabelForEvents(events: ActivityEvent[]) {
    if (events.length === 0) return "";
    const counts: Record<ActivityEvent["type"], number> = {
      funding: 0,
      claim: 0,
      payout: 0,
      refund: 0,
      linked_pr: 0,
    };
    for (const event of events) counts[event.type] += 1;

    const ordered: Array<[ActivityEvent["type"], string]> = [
      ["funding", "Funding"],
      ["claim", "Claim"],
      ["payout", "Payout"],
      ["refund", "Refund"],
      ["linked_pr", "Linked PR"],
    ];
    const parts: string[] = [];
    for (const [key, label] of ordered) {
      const count = counts[key];
      if (count <= 0) continue;
      parts.push(`${count} ${count === 1 ? label : `${label}s`}`);
    }
    return parts.join(", ");
  }

  function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
  }

  function truncateDecimals(value: string, maxDecimals: number) {
    const dot = value.indexOf(".");
    if (dot === -1) return value;
    const decimals = value.slice(dot + 1);
    if (decimals.length <= maxDecimals) return value;
    return `${value.slice(0, dot)}.${decimals.slice(0, maxDecimals)}`;
  }

  function lockedFundsTooltipForDay(
    tokenLabel: string,
    tokenDecimals: number,
    day: number,
    totalWei: bigint,
    lockedRemainingWei: bigint,
    unlockableTodayWei: bigint
  ) {
    const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    const dateLine = fmt.format(unlockDateAtDay(day));

    const clampedLocked = lockedRemainingWei < 0n ? 0n : lockedRemainingWei;
    const clampedTotal = totalWei < 0n ? 0n : totalWei;
    const unlockedWei = clampedTotal > clampedLocked ? clampedTotal - clampedLocked : 0n;

    let locked = clampedLocked.toString();
    let escrowed = clampedTotal.toString();
    let unlocked = unlockedWei.toString();
    let unlockableToday = unlockableTodayWei.toString();
    try {
      locked = formatUnits(clampedLocked, tokenDecimals);
      escrowed = formatUnits(clampedTotal, tokenDecimals);
      unlocked = formatUnits(unlockedWei, tokenDecimals);
      unlockableToday = formatUnits(unlockableTodayWei < 0n ? 0n : unlockableTodayWei, tokenDecimals);
    } catch {
      // ignore
    }

    const lines: string[] = [dateLine];
    lines.push(`Max claimable: ${escrowed} ${tokenLabel}`);
    lines.push(`Funds locked: ${locked} ${tokenLabel}`);
    lines.push(`Funds withdrawable by funders: ${unlocked} ${tokenLabel}`);
    return lines.join("\n");
  }

  function renderActivityDateAxis() {
    const dayCount = Math.max(1, maxDay + 1);
    if (dayCount === 1) {
      return (
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{formatDate(startDate)}</span>
          <span>{formatDate(endDate)}</span>
        </div>
      );
    }

    const startYear = activityDateAtDay(0).getUTCFullYear();
    const endYear = activityDateAtDay(maxDay).getUTCFullYear();
    const sameYear = startYear === endYear;

    const fmtNoYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const fmtWithYear = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });

    // Rough label widths (px). We thin labels before they visually overlap.
    const LABEL_NO_YEAR_PX = 44;
    const LABEL_WITH_YEAR_PX = 76;
    const LABEL_GAP_PX = 6;

    const isJan1 = (day: number) => {
      const d = activityDateAtDay(day);
      return d.getUTCMonth() === 0 && d.getUTCDate() === 1;
    };

    const includeYearForDay = (day: number) => {
      // Show year at the ends when the year is the same.
      if (sameYear) return day === 0 || day === maxDay;
      // When the year changes across the range, show year at ends and on Jan 1 boundaries.
      return day === 0 || day === maxDay || isJan1(day);
    };

    const labelTextForDay = (day: number) => {
      const d = activityDateAtDay(day);
      return includeYearForDay(day) ? fmtWithYear.format(d) : fmtNoYear.format(d);
    };

    const labelWidthForDay = (day: number) => (includeYearForDay(day) ? LABEL_WITH_YEAR_PX : LABEL_NO_YEAR_PX);

    // First pass: pick a cadence from available per-day width.
    const dayWidth = activityBarWidth > 0 ? activityBarWidth / dayCount : 0;
    const step = dayWidth > 0 ? Math.max(1, Math.ceil(LABEL_NO_YEAR_PX / dayWidth)) : Math.max(1, Math.ceil(dayCount / 8));

    // Pin endpoints; also pin Jan 1 boundaries if the year changes across the range.
    const pinned = new Set<number>([0, maxDay]);
    if (!sameYear) {
      for (let day = 1; day < maxDay; day++) {
        if (isJan1(day)) pinned.add(day);
      }
    }

    const candidates = new Set<number>(pinned);
    for (let day = 0; day <= maxDay; day += step) candidates.add(day);
    candidates.add(maxDay);

    const sorted = Array.from(candidates).sort((a, b) => a - b);

    // Second pass: drop labels that overlap, keeping pinned ones.
    const kept: Array<{ day: number; start: number; end: number }> = [];
    const overlapsKept = (startPx: number, endPx: number) =>
      kept.some((k) => !(endPx + LABEL_GAP_PX <= k.start || startPx - LABEL_GAP_PX >= k.end));

    const tryKeep = (day: number) => {
      if (activityBarWidth <= 0) {
        if (pinned.has(day)) kept.push({ day, start: 0, end: 0 });
        return;
      }

      const w = labelWidthForDay(day);
      let startPx = 0;
      let endPx = 0;

      if (day === 0) {
        startPx = 0;
        endPx = w;
      } else if (day === maxDay) {
        startPx = Math.max(0, activityBarWidth - w);
        endPx = activityBarWidth;
      } else {
        const x = (day / maxDay) * activityBarWidth;
        startPx = x - w / 2;
        endPx = x + w / 2;
      }

      if (overlapsKept(startPx, endPx)) return;
      kept.push({ day, start: startPx, end: endPx });
    };

    Array.from(pinned).sort((a, b) => a - b).forEach((day) => tryKeep(day));
    sorted.filter((day) => !pinned.has(day)).forEach((day) => tryKeep(day));

    const finalDays = Array.from(new Set(kept.map((k) => k.day))).sort((a, b) => a - b);

    return (
      <div className="relative h-4 text-[10px] text-muted-foreground">
        {finalDays.map((day) => {
          const label = labelTextForDay(day);
          if (day === 0) {
            return (
              <span key={day} className="absolute left-0 top-0 whitespace-nowrap">
                {label}
              </span>
            );
          }
          if (day === maxDay) {
            return (
              <span key={day} className="absolute right-0 top-0 whitespace-nowrap text-right">
                {label}
              </span>
            );
          }

          const leftPct = (day / maxDay) * 100;
          return (
            <span
              key={day}
              className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${leftPct}%` }}
            >
              {label}
            </span>
          );
        })}
      </div>
    );
  }

  function renderUnlockDateAxis() {
    const dayCount = Math.max(1, unlockMaxDay + 1);
    if (dayCount === 1) return null;

    const startYear = unlockDateAtDay(0).getUTCFullYear();
    const endYear = unlockDateAtDay(unlockMaxDay).getUTCFullYear();
    const sameYear = startYear === endYear;

    const fmtNoYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const fmtWithYear = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });

    const LABEL_NO_YEAR_PX = 44;
    const LABEL_WITH_YEAR_PX = 76;
    const LABEL_GAP_PX = 6;

    const isJan1 = (day: number) => {
      const d = unlockDateAtDay(day);
      return d.getUTCMonth() === 0 && d.getUTCDate() === 1;
    };

    const includeYearForDay = (day: number) => {
      if (sameYear) return day === 0 || day === unlockMaxDay;
      return day === 0 || day === unlockMaxDay || isJan1(day);
    };

    const labelTextForDay = (day: number) => {
      const d = unlockDateAtDay(day);
      return includeYearForDay(day) ? fmtWithYear.format(d) : fmtNoYear.format(d);
    };

    const labelWidthForDay = (day: number) => (includeYearForDay(day) ? LABEL_WITH_YEAR_PX : LABEL_NO_YEAR_PX);

    const dayWidth = unlockBarWidth > 0 ? unlockBarWidth / dayCount : 0;
    const step = dayWidth > 0 ? Math.max(1, Math.ceil(LABEL_NO_YEAR_PX / dayWidth)) : Math.max(1, Math.ceil(dayCount / 8));

    const pinned = new Set<number>([0, unlockMaxDay]);
    if (!sameYear) {
      for (let day = 1; day < unlockMaxDay; day++) {
        if (isJan1(day)) pinned.add(day);
      }
    }

    const candidates = new Set<number>(pinned);
    for (let day = 0; day <= unlockMaxDay; day += step) candidates.add(day);
    candidates.add(unlockMaxDay);

    const sorted = Array.from(candidates).sort((a, b) => a - b);

    const kept: Array<{ day: number; start: number; end: number }> = [];
    const overlapsKept = (startPx: number, endPx: number) =>
      kept.some((k) => !(endPx + LABEL_GAP_PX <= k.start || startPx - LABEL_GAP_PX >= k.end));

    const tryKeep = (day: number) => {
      if (unlockBarWidth <= 0) {
        if (pinned.has(day)) kept.push({ day, start: 0, end: 0 });
        return;
      }

      const w = labelWidthForDay(day);
      let startPx = 0;
      let endPx = 0;

      if (day === 0) {
        startPx = 0;
        endPx = w;
      } else if (day === unlockMaxDay) {
        startPx = Math.max(0, unlockBarWidth - w);
        endPx = unlockBarWidth;
      } else {
        const x = (day / unlockMaxDay) * unlockBarWidth;
        startPx = x - w / 2;
        endPx = x + w / 2;
      }

      if (overlapsKept(startPx, endPx)) return;
      kept.push({ day, start: startPx, end: endPx });
    };

    Array.from(pinned).sort((a, b) => a - b).forEach((day) => tryKeep(day));
    sorted.filter((day) => !pinned.has(day)).forEach((day) => tryKeep(day));

    const finalDays = Array.from(new Set(kept.map((k) => k.day))).sort((a, b) => a - b);

    return (
      <div className="relative h-4 text-[10px] text-muted-foreground">
        {finalDays.map((day) => {
          const label = labelTextForDay(day);
          if (day === 0) {
            return (
              <span key={day} className="absolute left-0 top-0 whitespace-nowrap">
                {label}
              </span>
            );
          }
          if (day === unlockMaxDay) {
            return (
              <span key={day} className="absolute right-0 top-0 whitespace-nowrap text-right">
                {label}
              </span>
            );
          }

          const leftPct = (day / unlockMaxDay) * 100;
          return (
            <span
              key={day}
              className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${leftPct}%` }}
              title={label}
            >
              {label}
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div className="relative grid gap-4 rounded-md bg-muted/40 p-4 text-sm">
      <div className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-5">
        {unlockSchedules.length ? (
          <>
            <div className="text-xs uppercase text-muted-foreground pt-1">Locked funds</div>
            <div className="min-w-0 space-y-1">
              {/* Single grid so token labels, bars, and axis share the same column widths. */}
              <div className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1">
                {unlockSchedules.map((schedule, scheduleIdx) => {
                  const meta = getTokenMeta(schedule.token, issue.chainId);

                  let total = 0n;
                  try {
                    total = schedule.totalEscrowedWei ? BigInt(schedule.totalEscrowedWei) : 0n;
                  } catch {
                    total = 0n;
                  }

                  // `unlockableByDay` is how much becomes withdrawable for funders at each day.
                  const unlockableByDay = new Map<number, bigint>();
                  schedule.days.forEach((d) => {
                    const prev = unlockableByDay.get(d.day) ?? 0n;
                    try {
                      unlockableByDay.set(d.day, prev + BigInt(d.amountWei));
                    } catch {
                      // ignore malformed
                    }
                  });

                  const dayCount = Math.max(1, unlockMaxDay + 1);
                  const lockedRemainingByDay: bigint[] = [];
                  let unlockedSoFar = 0n;
                  for (let day = 0; day <= unlockMaxDay; day++) {
                    unlockedSoFar += unlockableByDay.get(day) ?? 0n;
                    const lockedRemaining = total > unlockedSoFar ? total - unlockedSoFar : 0n;
                    lockedRemainingByDay.push(lockedRemaining);
                  }

                  const labelDays = Array.from(unlockableByDay.entries())
                    .filter(([, amt]) => amt > 0n)
                    .map(([day]) => day)
                    .sort((a, b) => a - b);

                  const gridCols = `repeat(${dayCount}, minmax(0, 1fr))`;

                  return (
                    <React.Fragment key={schedule.token}>
                      <div className="self-end text-xs text-muted-foreground">{meta.label}</div>
                      <div
                        className="grid items-end text-[10px] text-muted-foreground tabular-nums"
                        style={{ gridTemplateColumns: gridCols }}
                      >
                        {labelDays.map((day) => {
                          const lockedRemaining = lockedRemainingByDay[day] ?? 0n;
                          if (lockedRemaining <= 0n) return null;
                          let display = lockedRemaining.toString();
                          try {
                            display = formatUnits(lockedRemaining, meta.decimals);
                          } catch {
                            // ignore
                          }
                          const truncated = truncateDecimals(display, 3);
                          return (
                            <div key={day} className="min-w-0 text-center" style={{ gridColumnStart: day + 1 }}>
                              {truncated}
                            </div>
                          );
                        })}
                      </div>

                      <div />
                      <div
                        className="relative w-full min-w-0"
                        onMouseLeave={() => setLockedHover((prev) => (prev?.token === schedule.token ? null : prev))}
                      >
                        {lockedHover && lockedHover.token === schedule.token ? (
                          <div
                            className="pointer-events-none absolute -top-2 z-20 -translate-x-1/2 -translate-y-full whitespace-pre rounded-md border bg-background px-2 py-1 text-[10px] text-foreground shadow-md"
                            style={{ left: `${lockedHover.leftPct}%` }}
                          >
                            {lockedHover.text}
                          </div>
                        ) : null}

                        <div
                          ref={scheduleIdx === 0 ? unlockBarRef : null}
                          className="flex h-2 w-full min-w-0 overflow-hidden rounded-full bg-muted-foreground/20"
                        >
                          {Array.from({ length: dayCount }, (_, day) => {
                            const unlockableToday = unlockableByDay.get(day) ?? 0n;
                            const lockedRemaining = lockedRemainingByDay[day] ?? 0n;
                            const tooltip = lockedFundsTooltipForDay(
                              meta.label,
                              meta.decimals,
                              day,
                              total,
                              lockedRemaining,
                              unlockableToday
                            );

                            const leftPct = clamp(((day + 0.5) / Math.max(1, unlockMaxDay + 1)) * 100, 5, 95);

                            if (lockedRemaining <= 0n) {
                              return (
                                <span
                                  key={day}
                                  data-no-row-toggle
                                  className="h-full flex-1 bg-transparent"
                                  aria-label={tooltip.replaceAll("\n", " · ")}
                                  onMouseEnter={() => setLockedHover({ token: schedule.token, leftPct, text: tooltip })}
                                />
                              );
                            }

                            let opacity = 0.7;
                            if (total > 0n) {
                              const ratio = Number((lockedRemaining * 1000n) / total) / 1000;
                              const clamped = Math.max(0, Math.min(1, ratio));
                              const scaled = Math.pow(clamped, 1.6);
                              opacity = Math.min(1, 0.12 + 0.88 * scaled);
                            }

                            return (
                              <span
                                key={day}
                                data-no-row-toggle
                                className="h-full flex-1 bg-foreground"
                                style={{ opacity }}
                                aria-label={tooltip.replaceAll("\n", " · ")}
                                onMouseEnter={() => setLockedHover({ token: schedule.token, leftPct, text: tooltip })}
                              />
                            );
                          })}
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
                <div />
                <div className="min-w-0">{renderUnlockDateAxis()}</div>
              </div>
            </div>
          </>
        ) : null}

        <div className="text-xs uppercase text-muted-foreground pt-1">Activity</div>
        <div className="min-w-0 space-y-2">
          <div
            className="grid items-end text-[10px] text-muted-foreground"
            style={{ gridTemplateColumns: `repeat(${Math.max(1, maxDay + 1)}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: Math.max(1, maxDay + 1) }, (_, day) => {
              const dayEvents = days.find((d) => d.day === day)?.events ?? [];
              const label = activityLabelForEvents(dayEvents);
              return (
                <div key={day} className="min-w-0 truncate text-center" data-no-row-toggle>
                  {label}
                </div>
              );
            })}
          </div>
          <div
            ref={activityBarRef}
            className="grid h-2 overflow-hidden rounded-full bg-muted-foreground/20"
            style={{ gridTemplateColumns: `repeat(${Math.max(1, maxDay + 1)}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: Math.max(1, maxDay + 1) }, (_, day) => {
              const dayEvents = days.find((d) => d.day === day)?.events ?? [];
              const events = sortedDayEvents({ day, events: dayEvents });

              if (events.length === 0) {
                // Explicit "no activity" segment so gaps in the timeline are visible.
                return <div key={day} data-no-row-toggle className="h-full bg-transparent" />;
              }

              // Multiple events in a day subdivide that day's segment.
              return (
                <div key={day} data-no-row-toggle className="flex h-full overflow-hidden">
                  {events.map((event, idx) => (
                    <span key={`${day}-${event.timestamp}-${event.type}-${idx}`} className={`h-full flex-1 ${activityColor(event.type)}`} />
                  ))}
                </div>
              );
            })}
          </div>
          {renderActivityDateAxis()}
        </div>

	        <div className="text-xs uppercase text-muted-foreground pt-1">History</div>
	        <div className="min-w-0 space-y-2">
	          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
	            <span>Fundings: {issue.counts.fundings}</span>
	            <span aria-hidden="true">·</span>
	            <span>Claims: {issue.counts.claims}</span>
	            <span aria-hidden="true">·</span>
	            <span>Payouts: {issue.counts.payouts}</span>
	            <span aria-hidden="true">·</span>
	            <span>Refunds: {issue.counts.refunds}</span>
	            <span aria-hidden="true">·</span>
	            <span>Linked PRs: {issue.counts.linkedPrs ?? 0}</span>
	          </div>
          {assets.length ? (
            <div className="space-y-1 text-xs text-muted-foreground">
              {assets.map((asset) => {
                const meta = getTokenMeta(asset.token, issue.chainId);
                let refundedWei = "0";
                try {
                  const funded = BigInt(asset.fundedWei);
                  const escrowed = BigInt(asset.escrowedWei);
                  const paid = BigInt(asset.paidWei);
                  const refunded = funded - escrowed - paid;
                  refundedWei = (refunded > 0n ? refunded : 0n).toString();
                } catch {
                  refundedWei = "0";
                }
                return (
                  <div key={asset.token}>
                    {meta.label}: {formatAmount(asset.fundedWei, meta.decimals)} funded /{" "}
                    {formatAmount(asset.escrowedWei, meta.decimals)} in active bounty /{" "}
                    {formatAmount(asset.paidWei, meta.decimals)} paid /{" "}
                    {formatAmount(refundedWei, meta.decimals)} refunded/withdrawn
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">No assets recorded.</div>
          )}
        </div>

	        <div className="text-xs uppercase text-muted-foreground pt-1">Identifiers</div>
	        <div className="min-w-0">
	          <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
	            <Link
	              href={`/bounty/${issue.bountyId}`}
	              className="inline-flex items-center gap-1 text-xs text-foreground hover:underline"
	              data-no-row-toggle
	            >
	              <Share2 className="h-3.5 w-3.5" />
	              share bounty
	            </Link>
	            <span className="font-mono text-xs">repoHash: {issue.repoHash}</span>
	            <span className="font-mono text-xs">
	              bountyId:{" "}
	              <Link href={`/bounty/${issue.bountyId}`} className="text-muted-foreground hover:underline hover:text-foreground">
	                {issue.bountyId}
	              </Link>
	            </span>
	          </div>
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
  onClaim,
}: {
  columns: ColumnDef<IssueRow>[];
  data: IssueRow[];
  showUsdc: boolean;
  walletAddress: Address | null;
  myFundingOnly: boolean;
  setMyFundingOnly: (next: boolean) => void;
  githubUser: GithubUser | null;
  onClaim: (issue: IssueRow) => void;
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
      />
      <div className="rounded-md border">
        <Table>
	          <TableHeader>
	            {table.getHeaderGroups().map((headerGroup) => (
	              <TableRow key={headerGroup.id}>
	                {headerGroup.headers.map((header) => (
	                  <TableHead
	                    key={header.id}
	                    className={cn((header.column.columnDef.meta as any)?.thClassName)}
	                  >
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
	                      <TableCell
	                        key={cell.id}
	                        className={cn((cell.column.columnDef.meta as any)?.tdClassName)}
	                      >
	                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
	                      </TableCell>
	                    ))}
	                  </TableRow>
                  {row.getIsExpanded() ? (
                    <TableRow>
                      <TableCell colSpan={columns.length}>
                        <ExpandedIssueRow
                          issue={row.original}
                          showUsdc={showUsdc}
                          walletAddress={walletAddress}
                          githubUser={githubUser}
                          onClaim={onClaim}
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
