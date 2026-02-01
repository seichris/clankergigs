export type IssueAsset = {
  token: string;
  fundedWei: string;
  escrowedWei: string;
  paidWei: string;
};

export type GithubIssueLabel = {
  name: string;
  color: string;
};

export type GithubIssueAuthor = {
  login: string;
  avatar_url?: string | null;
} | null;

export type GithubIssueSummary = {
  title: string;
  state: string;
  labels: GithubIssueLabel[];
  updatedAt: string;
  htmlUrl: string;
  author: GithubIssueAuthor;
  repo?: {
    description: string | null;
    homepage: string | null;
    htmlUrl: string | null;
  } | null;
};

export type IssueCounts = {
  fundings: number;
  claims: number;
  payouts: number;
  refunds: number;
  linkedPrs?: number;
};

export type UnlockDay = {
  day: number;
  amountWei: string;
};

export type UnlockSchedule = {
  token: string;
  totalEscrowedWei: string;
  days: UnlockDay[];
};

export type LinkedPullRequest = {
  prUrl: string;
  createdAt: string;
};

export type ActivityEvent = {
  type: "funding" | "claim" | "payout" | "refund" | "linked_pr";
  timestamp: string;
};

export type ActivityDay = {
  day: number;
  events: ActivityEvent[];
};

export type ActivityTimeline = {
  startDate: string;
  endDate: string;
  maxDay: number;
  days: ActivityDay[];
};

export type IssueRow = {
  issueUrl: string;
  owner: string | null;
  repo: string | null;
  issueNumber: number | null;
  repoHash: string;
  bountyId: string;
  status: string;
  chainId: number;
  contractAddress: string;
  createdAt: string;
  updatedAt: string;
  assets: IssueAsset[];
  unlockSchedule?: UnlockSchedule[];
  activityTimeline?: ActivityTimeline;
  funders?: string[];
  linkedPullRequests?: LinkedPullRequest[];
  counts: IssueCounts;
  github?: GithubIssueSummary | null;
};
