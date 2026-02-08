import { z } from "zod";
import dotenv from "dotenv";

const EnvSchema = z.object({
  // Keep DB under prisma/ to avoid clutter and match .gitignore.
  DATABASE_URL: z.string().min(1).default("file:./prisma/dev.db"),
  // Primary RPC URL (local dev, custom chains, etc.). If unset/empty, we fall back to chain-specific RPCs.
  RPC_URL: z.string().optional().or(z.literal("")).default(""),
  // Chain-specific Ethereum RPCs (used when CHAIN_ID matches and RPC_URL is unset/empty).
  RPC_URLS_ETHEREUM_MAINNET: z.string().optional().or(z.literal("")).default(""),
  RPC_URLS_ETHEREUM_SEPOLIA: z.string().optional().or(z.literal("")).default(""),
  RPC_URL_ETHEREUM_MAINNET: z.string().optional().or(z.literal("")).default(""),
  RPC_URL_ETHEREUM_SEPOLIA: z.string().optional().or(z.literal("")).default(""),
  CHAIN_ID: z.coerce.number().int().positive().default(31337),
  CONTRACT_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional()
    .or(z.literal("")),
  // Used to validate OAuth returnTo redirects.
  // If set, it should be the public URL origin for the API (e.g. https://api.example.com).
  API_ORIGIN: z.string().optional().or(z.literal("")),
  WEB_ORIGIN: z.string().optional().or(z.literal("")),
  // Comma-separated allowlist of origins for `returnTo` in /auth/github/start.
  // If set, it takes precedence over WEB_ORIGIN/API_ORIGIN.
  ALLOWED_RETURN_TO_ORIGINS: z.string().optional().or(z.literal("")),
  GITHUB_OAUTH_CLIENT_ID: z.string().optional().or(z.literal("")),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional().or(z.literal("")),
  GITHUB_OAUTH_CALLBACK_URL: z.string().optional().or(z.literal("")),
  GITHUB_OAUTH_SCOPE: z.string().optional().or(z.literal("")),
  // Used for CLI device-flow sessions (Option 2).
  // 32-byte hex key (64 hex chars). If unset, device-flow endpoints should be treated as disabled.
  API_TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional()
    .or(z.literal("")),
  API_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
  API_SESSION_TOKEN_PREFIX: z.string().optional().or(z.literal("")),
  BACKEND_SIGNER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional()
    .or(z.literal("")),
  DAO_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional()
    .or(z.literal("")),
  DAO_DELAY_SECONDS: z.coerce.number().int().min(0).default(0),
  GITHUB_WEBHOOK_SECRET: z.string().optional().or(z.literal("")),
  GITHUB_BACKFILL_SECRET: z.string().optional().or(z.literal("")),
  GITHUB_APP_ID: z.string().optional().or(z.literal("")),
  GITHUB_INSTALLATION_ID: z.string().optional().or(z.literal("")),
  GITHUB_PRIVATE_KEY_PEM: z.string().optional().or(z.literal("")),
  GITHUB_TOKEN: z.string().optional().or(z.literal("")),
  GITHUB_BACKFILL_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(60),
  INDEXER_BACKFILL_BLOCK_CHUNK: z.coerce.number().int().min(1).default(10),
  GITHUB_AUTH_MODE: z
    .preprocess(
      (value) => (typeof value === "string" ? value.toLowerCase() : value),
      z.enum(["pat", "app"])
    )
    .optional()
    .default("pat"),
  // ---- Treasury / Circle (optional) ----
  TREASURY_ENABLED: z.coerce.number().int().min(0).max(1).default(0),
  TREASURY_ARC_CHAIN_ID: z.coerce.number().int().positive().default(5042002),
  TREASURY_ARC_RPC_URL: z.string().optional().or(z.literal("")).default("https://rpc.testnet.arc.network"),
  TREASURY_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional()
    .or(z.literal("")),
  TREASURY_DESTINATION_CALLER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional()
    .or(z.literal("")),
  TREASURY_ORCHESTRATOR_ENABLED: z.coerce.number().int().min(0).max(1).default(1),
  TREASURY_ORCHESTRATOR_INTERVAL_MS: z.coerce.number().int().min(250).default(2500),
  CIRCLE_GATEWAY_API_URL: z.string().optional().or(z.literal("")).default("https://gateway-api-testnet.circle.com"),
  // Circle Wallets (optional; enables Bridge Kit Circle Wallets adapter)
  CIRCLE_API_KEY: z.string().optional().or(z.literal("")),
  CIRCLE_ENTITY_SECRET: z.string().optional().or(z.literal("")),
  CIRCLE_WALLETS_BASE_URL: z.string().optional().or(z.literal("")),
  PORT: z.coerce.number().int().positive().default(8787)
});

type ParsedEnv = z.infer<typeof EnvSchema>;

export type Env = ParsedEnv & { RPC_URLS: string[] };

function sanitizeRpcUrl(input: string) {
  let url = input.trim();
  if (!url) return "";
  // Handle values pasted with quotes (common in hosting dashboards), e.g. `"https://..."`.
  url = url.replace(/^['"`]+/, "").replace(/['"`]+$/, "").trim();
  // Handle common typo: `https:/host` (missing one slash).
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

export function loadEnv(): Env {
  dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || "../../.env" });
  // Optional branch-specific DB override.
  // If DATABASE_URL is unset, allow DATABASE_URL_FEAT_ARC to provide an alternate SQLite file
  // so feature-branch migrations don't touch your main-branch local DB.
  if (!process.env.DATABASE_URL && process.env.DATABASE_URL_FEAT_ARC) {
    process.env.DATABASE_URL = process.env.DATABASE_URL_FEAT_ARC;
  }
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Keep the error readable in CLI.
    // eslint-disable-next-line no-console
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }
  const env = parsed.data;

  let rpcUrls = parseRpcUrls(env.RPC_URL);
  if (rpcUrls.length === 0) {
    if (env.CHAIN_ID === 1) {
      rpcUrls = parseRpcUrls(env.RPC_URLS_ETHEREUM_MAINNET);
      if (rpcUrls.length === 0) rpcUrls = parseRpcUrls(env.RPC_URL_ETHEREUM_MAINNET);
    } else if (env.CHAIN_ID === 11155111) {
      rpcUrls = parseRpcUrls(env.RPC_URLS_ETHEREUM_SEPOLIA);
      if (rpcUrls.length === 0) rpcUrls = parseRpcUrls(env.RPC_URL_ETHEREUM_SEPOLIA);
    }
  }

  const rpcUrl = rpcUrls[0] || "";

  return { ...env, RPC_URL: rpcUrl, RPC_URLS: rpcUrls };
}
