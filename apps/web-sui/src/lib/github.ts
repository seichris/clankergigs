type ParsedGitHubIssue = {
  owner: string;
  repo: string;
  fullRepo: string; // owner/repo
  issueNumber: number;
  url: string; // canonical issue URL
};

type ParsedGitHubPull = {
  owner: string;
  repo: string;
  fullRepo: string; // owner/repo
  pullNumber: number;
  url: string; // canonical PR URL
};

function parsePositiveInt(s: string) {
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function parseGitHubIssueUrl(raw: string): ParsedGitHubIssue {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("Invalid URL");
  }

  if (u.hostname !== "github.com") throw new Error("Issue URL must be on github.com");
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 4) throw new Error("Expected GitHub issue URL like /<owner>/<repo>/issues/<n>");

  const [owner, repo, kind, numStr] = parts;
  if (!owner || !repo || kind !== "issues") throw new Error("Expected GitHub issue URL like /<owner>/<repo>/issues/<n>");

  const issueNumber = parsePositiveInt(numStr);
  if (!issueNumber) throw new Error("Issue number must be a positive integer");

  const fullRepo = `${owner}/${repo}`;
  const url = `https://github.com/${owner}/${repo}/issues/${issueNumber}`;

  return { owner, repo, fullRepo, issueNumber, url };
}

export function parseGitHubPullUrl(raw: string): ParsedGitHubPull {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("Invalid URL");
  }

  if (u.hostname !== "github.com") throw new Error("PR URL must be on github.com");
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 4) throw new Error("Expected GitHub PR URL like /<owner>/<repo>/pull/<n>");

  const [owner, repo, kind, numStr] = parts;
  if (!owner || !repo || kind !== "pull") throw new Error("Expected GitHub PR URL like /<owner>/<repo>/pull/<n>");

  const pullNumber = parsePositiveInt(numStr);
  if (!pullNumber) throw new Error("PR number must be a positive integer");

  const fullRepo = `${owner}/${repo}`;
  const url = `https://github.com/${owner}/${repo}/pull/${pullNumber}`;

  return { owner, repo, fullRepo, pullNumber, url };
}

