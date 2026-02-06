import { z } from "zod";
import dotenv from "dotenv";

function coerceOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return undefined;
  return n;
}

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1).default("file:./prisma/dev.db"),
  // Some platforms inject a non-numeric PORT (e.g. "tcp://..."). Treat those as unset.
  PORT: z.preprocess(coerceOptionalNumber, z.number().int().positive().default(8788)),

  // Sui indexer
  SUI_RPC_URL: z.string().min(1),
  // Sui package id (0x...) that emits the events.
  SUI_PACKAGE_ID: z.string().min(1),
  SUI_POLL_INTERVAL_MS: z.preprocess(coerceOptionalNumber, z.number().int().min(250).default(2000)),
  SUI_EVENT_PAGE_SIZE: z.preprocess(coerceOptionalNumber, z.number().int().min(1).max(200).default(50)),

  // CORS / cookies (if you later add OAuth sessions)
  WEB_ORIGIN: z.string().optional().or(z.literal("")).default("http://localhost:3001")
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  // Default to an app-local env file for the Sui stack.
  // Deployments can override via DOTENV_CONFIG_PATH or direct env vars.
  dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || "./.env" });
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }
  return parsed.data;
}
