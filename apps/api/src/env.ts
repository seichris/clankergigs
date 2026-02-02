import { z } from "zod";
import dotenv from "dotenv";

const EnvSchema = z.object({
  // Keep DB under prisma/ to avoid clutter and match .gitignore.
  DATABASE_URL: z.string().min(1).default("file:./prisma/dev.db"),
  RPC_URL: z.string().default("http://127.0.0.1:8545"),
  CHAIN_ID: z.coerce.number().int().positive().default(31337),
  CONTRACT_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional()
    .or(z.literal("")),
  WEB_ORIGIN: z.string().optional().or(z.literal("")),
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

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || "../../.env" });
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Keep the error readable in CLI.
    // eslint-disable-next-line no-console
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }
  return parsed.data;
}
