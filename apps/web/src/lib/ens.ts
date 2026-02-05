import { createPublicClient, fallback, http } from "viem";
import { mainnet } from "viem/chains";

let ensClient: ReturnType<typeof createPublicClient> | null = null;

function parseRpcUrls(value: string | undefined) {
  return (value || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

function ensRpcUrls() {
  const urls = parseRpcUrls(process.env.NEXT_PUBLIC_RPC_URLS_ETHEREUM_MAINNET);
  if (urls.length > 0) return urls;
  const legacy = parseRpcUrls(process.env.NEXT_PUBLIC_RPC_URL_ETHEREUM_MAINNET);
  if (legacy.length > 0) return legacy;
  const override = parseRpcUrls(process.env.NEXT_PUBLIC_ENS_RPC_URL);
  if (override.length > 0) return override;
  return [];
}

function ensDemoAddress() {
  return (process.env.NEXT_PUBLIC_ENS_DEMO_ADDRESS || "").trim().toLowerCase();
}

function ensDemoName() {
  return (process.env.NEXT_PUBLIC_ENS_DEMO_NAME || "").trim();
}

export function getEnsPublicClient() {
  const urls = ensRpcUrls();
  if (urls.length === 0) return null;
  if (ensClient) return ensClient;
  const transport = urls.length > 1 ? fallback(urls.map((url) => http(url))) : http(urls[0]!);
  ensClient = createPublicClient({
    chain: mainnet,
    transport,
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

export function getDemoEnsNameForAddress(address: string) {
  const demoAddress = ensDemoAddress();
  const demoName = ensDemoName();
  if (!demoAddress || !demoName) return null;
  if (address.trim().toLowerCase() !== demoAddress) return null;
  return demoName;
}

export function getDemoEnsTextRecord(name: string, key: string) {
  const demoName = ensDemoName();
  if (!demoName) return null;
  if (name.trim().toLowerCase() !== demoName.trim().toLowerCase()) return null;
  if (key !== "com.github") return null;
  const value = (process.env.NEXT_PUBLIC_ENS_DEMO_COM_GITHUB || "").trim();
  if (!value) return null;
  return value;
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
