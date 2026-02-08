import { loadEnv } from "./env.js";
import { buildServer } from "./server.js";
import { startIndexer } from "./indexer/indexer.js";

async function main() {
  const env = loadEnv();
  process.env.DATABASE_URL ||= env.DATABASE_URL;

  const app = await buildServer();
  await startIndexer(env, app.log);

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  app.log.info({ port: env.PORT }, "api-sui started");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
