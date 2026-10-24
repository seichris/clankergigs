import { mainnet, sepolia } from "viem/chains";
import { defineChain } from "viem";

function sanitizeRpcUrl(input: string) {
  let url = input.trim();
  if (!url) return "";

  // Common misconfig: env values pasted with quotes, e.g. `"https://..."`.
  url = url.replace(/^['"`]+/, "").replace(/['"`]+$/, "").trim();

  // Common typo: `https:/host` (missing one slash).
  url = url.replace(/^(https?):\/(?!\/)/i, "$1://");

  return url;
}

function parseRpcUrls(value: string | undefined) {
  const raw = (value || "").trim();
  if (!raw) return [];

  // Allow JSON array syntax in envs, e.g. `["https://a","https://b"]`.
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((v) => sanitizeRpcUrl(String(v))).filter(Boolean);
      }
    } catch {
      // fall through to comma-separated parsing
    }
  }

  return raw
    .split(",")
    .map((url) => sanitizeRpcUrl(url))
    .filter(Boolean);
}

function firstRpcUrls(...values: Array<string | undefined>) {
  for (const value of values) {
    const urls = parseRpcUrls(value);
    if (urls.length > 0) return urls;
  }
  return [];
}

export function appChain(id = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "31337")) {
  const legacyRpc = id === Number(process.env.NEXT_PUBLIC_CHAIN_ID || "31337") ? process.env.NEXT_PUBLIC_RPC_URL : undefined;
  if (id === 31337) {
    const rpcUrls = firstRpcUrls(legacyRpc);
    return defineChain({
      id: 31337,
      name: "Anvil",
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: {
        default: { http: rpcUrls.length ? rpcUrls : ["http://127.0.0.1:8545"] }
      }
    });
  }

  if (id === 11155111) {
    const rpcUrls = firstRpcUrls(
      process.env.NEXT_PUBLIC_RPC_URLS_ETHEREUM_SEPOLIA,
      process.env.NEXT_PUBLIC_RPC_URL_ETHEREUM_SEPOLIA,
      legacyRpc
    );
    return defineChain({
      id: 11155111,
      name: "Sepolia",
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: rpcUrls.length ? rpcUrls : [...sepolia.rpcUrls.default.http] } }
    });
  }

  if (id === 1) {
    const rpcUrls = firstRpcUrls(
      process.env.NEXT_PUBLIC_RPC_URLS_ETHEREUM_MAINNET,
      process.env.NEXT_PUBLIC_RPC_URL_ETHEREUM_MAINNET,
      legacyRpc
    );
    return defineChain({
      id: 1,
      name: "Ethereum",
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: rpcUrls.length ? rpcUrls : [...mainnet.rpcUrls.default.http] } }
    });
  }

  // Fallback: user must add their chain to wallet; this is for viem typing.
  const rpcUrls = firstRpcUrls(legacyRpc);
  return defineChain({
    id,
    name: `Chain ${id}`,
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: rpcUrls.length ? rpcUrls : [""] } }
  });
}
