"use client";

import * as React from "react";
import type { Table } from "@tanstack/react-table";
import { CheckCircle2, Circle, Tag, User, UserRound, X, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GITHUB_POST_LOGIN_HINT_KEY } from "@/lib/hooks/useGithubUser";

import type { IssueRow } from "./types";
import { DataTableFacetedFilter } from "./data-table-faceted-filter";

export function DataTableToolbar({
  table,
  globalFilter,
  setGlobalFilter,
  walletAddress,
  myFundingOnly,
  setMyFundingOnly,
  githubUser,
  onAddIssue,
}: {
  table: Table<IssueRow>;
  globalFilter: string;
  setGlobalFilter: (value: string) => void;
  walletAddress: string | null;
  myFundingOnly: boolean;
  setMyFundingOnly: (next: boolean) => void;
  githubUser: { login: string } | null;
  onAddIssue: () => void;
}) {
  const statusColumn = table.getColumn("status");
  const isFiltered = table.getState().columnFilters.length > 0 || globalFilter.length > 0 || myFundingOnly;
  const fundedValues = new Set<string>(myFundingOnly ? ["me"] : []);
  const labelColumn = table.getColumn("labels");
  const ownerColumn = table.getColumn("owner");
  const labelOptions = React.useMemo(() => {
    if (!labelColumn) return [];
    const labelSet = new Set<string>();
    table.getPreFilteredRowModel().rows.forEach((row) => {
      const labels = row.getValue("labels") as string[] | undefined;
      if (Array.isArray(labels)) {
        labels.forEach((label) => labelSet.add(label));
      }
    });
    return Array.from(labelSet)
      .sort((a, b) => a.localeCompare(b))
      .map((label) => ({ label, value: label, icon: Tag }));
  }, [labelColumn, table]);

  const ownerOptions = React.useMemo(() => {
    if (!ownerColumn) return [];
    const ownerSet = new Set<string>();
    table.getPreFilteredRowModel().rows.forEach((row) => {
      const owner = row.getValue("owner") as string | undefined;
      if (owner) ownerSet.add(owner);
    });
    return Array.from(ownerSet)
      .sort((a, b) => a.localeCompare(b))
      .map((owner) => ({ label: owner, value: owner, icon: UserRound }));
  }, [ownerColumn, table]);

  const highlightOwner = React.useMemo(() => {
    if (!githubUser) return false;
    const login = githubUser.login.toLowerCase();
    return table.getPreFilteredRowModel().rows.some((row) => {
      const issue = row.original as IssueRow;
      if (!issue.owner || issue.owner.toLowerCase() !== login) return false;
      return issue.assets?.some((asset) => {
        try {
          return BigInt(asset.escrowedWei) > 0n;
        } catch {
          return false;
        }
      });
    });
  }, [githubUser, table]);

  // Only show the "Your repo(s) has active bounties" hint after the user explicitly initiates
  // GitHub login (not on every reload where an auth cookie still exists).
  const [postLoginHintPending, setPostLoginHintPending] = React.useState(false);
  React.useEffect(() => {
    try {
      setPostLoginHintPending(sessionStorage.getItem(GITHUB_POST_LOGIN_HINT_KEY) === "1");
    } catch {
      setPostLoginHintPending(false);
    }
  }, []);

  const [ownerHighlightActive, setOwnerHighlightActive] = React.useState(false);
  const [ownerHighlightDismissed, setOwnerHighlightDismissed] = React.useState(false);

  React.useEffect(() => {
    if (!postLoginHintPending) return;

    // Wait until we actually have a logged-in GitHub user and rows to evaluate.
    if (!githubUser) return;
    const hasRows = table.getPreFilteredRowModel().rows.length > 0;
    if (!hasRows) return;

    if (highlightOwner && !ownerHighlightDismissed) {
      setOwnerHighlightActive(true);
      try {
        sessionStorage.removeItem(GITHUB_POST_LOGIN_HINT_KEY);
      } catch {
        // ignore
      }
      setPostLoginHintPending(false);
      return;
    }

    // If the user just logged in but doesn't have active bounties, consume the hint anyway.
    try {
      sessionStorage.removeItem(GITHUB_POST_LOGIN_HINT_KEY);
    } catch {
      // ignore
    }
    setPostLoginHintPending(false);
  }, [githubUser, highlightOwner, ownerHighlightDismissed, postLoginHintPending, table]);

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-1 flex-col gap-2 md:flex-row md:items-center">
        <Input
          placeholder="Search by repo, issue, status, hash..."
          value={globalFilter}
          onChange={(event) => setGlobalFilter(event.target.value)}
          className="md:w-[320px]"
        />
        {statusColumn ? (
          <DataTableFacetedFilter
            column={statusColumn}
            title="Status"
            options={[
              { label: "Open", value: "OPEN", icon: Circle },
              { label: "Implemented", value: "IMPLEMENTED", icon: CheckCircle2 },
              { label: "Closed", value: "CLOSED", icon: XCircle },
            ]}
          />
        ) : null}
        {walletAddress ? (
          <DataTableFacetedFilter
            title="Funded by"
            options={[{ label: "Me", value: "me", icon: User }]}
            selectedValues={fundedValues}
            onSelectedValuesChange={(next) => setMyFundingOnly(next.has("me"))}
          />
        ) : null}
        {ownerColumn && ownerOptions.length ? (
          <div className="flex flex-col gap-1">
            {ownerHighlightActive ? (
              <span className="text-[10px] uppercase tracking-wide text-red-500">
                Your repo(s) has active bounties
              </span>
            ) : null}
            <DataTableFacetedFilter
              column={ownerColumn}
              title="Repo owner"
              options={ownerOptions}
              highlight={ownerHighlightActive}
              onOpenChange={(open) => {
                if (open) {
                  setOwnerHighlightActive(false);
                  setOwnerHighlightDismissed(true);
                }
              }}
            />
          </div>
        ) : null}
        {labelColumn && labelOptions.length ? (
          <DataTableFacetedFilter
            column={labelColumn}
            title="Tags"
            options={labelOptions}
          />
        ) : null}
        {isFiltered ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              table.resetColumnFilters();
              setGlobalFilter("");
              setMyFundingOnly(false);
            }}
          >
            Clear
            <X className="ml-2 h-4 w-4" />
          </Button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onAddIssue} disabled={!walletAddress}>
          Add issue / fund bounty
        </Button>
      </div>
    </div>
  );
}
