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
  PORT: z.coerce.number().int().positive().default(8787)
});

type ParsedEnv = z.infer<typeof EnvSchema>;

export type Env = ParsedEnv & { RPC_URLS: string[] };

function parseRpcUrls(value: string | undefined) {
  return (value || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

export function loadEnv(): Env {
  dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || "../../.env" });
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
