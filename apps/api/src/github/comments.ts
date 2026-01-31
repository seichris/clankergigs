import { getGithubToken, type GithubAuthConfig } from "./appAuth.js";
import { parseGithubIssueUrl } from "./parse.js";

async function ghRequest(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `token ${token}`,
      "User-Agent": "gh-bounties",
      ...(init?.headers || {})
    }
  });
  return res;
}

export async function postIssueComment(opts: {
  github: GithubAuthConfig | null;
  issueUrl: string;
  body: string;
}) {
  if (!opts.github) return;
  const token = await getGithubToken(opts.github);
  if (!token) return;

  const { owner, repo, issueNumber } = parseGithubIssueUrl(opts.issueUrl);

  const res = await ghRequest(token, `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body: opts.body })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`postIssueComment failed: ${res.status} ${text}`);
  }
}
