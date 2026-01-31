export type ParsedIssue = {
  repoId: string; // github.com/{owner}/{repo}
  owner: string;
  repo: string;
  issueNumber: number;
};

export function parseGithubIssueUrl(input: string): ParsedIssue {
  const url = input.trim();
  // Accept:
  // - https://github.com/owner/repo/issues/123
  // - github.com/owner/repo/issues/123
  // - owner/repo#123 (shorthand)
  const m1 = url.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/i);
  if (m1) {
    const owner = m1[1];
    const repo = m1[2].replace(/\.git$/i, "");
    const issueNumber = Number(m1[3]);
    return { repoId: `github.com/${owner}/${repo}`, owner, repo, issueNumber };
  }

  const m2 = url.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (m2) {
    const owner = m2[1];
    const repo = m2[2].replace(/\.git$/i, "");
    const issueNumber = Number(m2[3]);
    return { repoId: `github.com/${owner}/${repo}`, owner, repo, issueNumber };
  }

  throw new Error("Invalid GitHub issue URL. Expected github.com/owner/repo/issues/123");
}

