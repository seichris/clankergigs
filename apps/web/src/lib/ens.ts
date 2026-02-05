import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

let ensClient: ReturnType<typeof createPublicClient> | null = null;

function ensRpcUrl() {
  return process.env.NEXT_PUBLIC_ENS_RPC_URL || "https://cloudflare-eth.com";
}

export function getEnsPublicClient() {
  if (ensClient) return ensClient;
  ensClient = createPublicClient({
    chain: mainnet,
    transport: http(ensRpcUrl()),
  });
  return ensClient;
}

export function isProbablyEnsName(value: string) {
  const v = value.trim();
  if (!v) return false;
  if (v.startsWith("0x")) return false;
  if (v.includes(" ")) return false;
  return v.includes(".");
}

export function normalizeGithubUsername(value: string | null | undefined) {
  const raw = (value || "").trim();
  if (!raw) return null;

  const withoutAt = raw.replace(/^@/, "");
  const lower = withoutAt.toLowerCase();

  // Common formats: "username", "@username", "https://github.com/username"
  const match = lower.match(/github\.com\/([a-z0-9-]+)/i);
  if (match?.[1]) return match[1];

  // If it's a URL-like string, keep just the last path segment.
  const last = lower.split("/").filter(Boolean).slice(-1)[0];
  if (!last) return null;

  return last;
}

