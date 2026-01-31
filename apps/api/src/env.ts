import { z } from "zod";
import dotenv from "dotenv";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1).default("file:./dev.db"),
  RPC_URL: z.string().default("http://127.0.0.1:8545"),
  CHAIN_ID: z.coerce.number().int().positive().default(31337),
  CONTRACT_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional()
    .or(z.literal("")),
  GITHUB_WEBHOOK_SECRET: z.string().optional().or(z.literal("")),
  GITHUB_APP_ID: z.string().optional().or(z.literal("")),
  GITHUB_INSTALLATION_ID: z.string().optional().or(z.literal("")),
  GITHUB_PRIVATE_KEY_PEM: z.string().optional().or(z.literal("")),
  GITHUB_TOKEN: z.string().optional().or(z.literal("")),
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
