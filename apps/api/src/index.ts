import { loadEnv } from "./env.js";
import { buildServer } from "./server.js";
import { startIndexer } from "./indexer/indexer.js";

async function main() {
  const env = loadEnv();
  // Prisma reads DATABASE_URL from process.env at construction time.
  process.env.DATABASE_URL ||= env.DATABASE_URL;

  const app = await buildServer();

  // Indexer is optional while bootstrapping the UI, but usually you'll set CONTRACT_ADDRESS.
  if (env.CONTRACT_ADDRESS && env.CONTRACT_ADDRESS.length > 0) {
    const githubMode = env.GITHUB_AUTH_MODE ?? "pat";
    const github =
      githubMode === "app"
        ? env.GITHUB_APP_ID && env.GITHUB_INSTALLATION_ID && env.GITHUB_PRIVATE_KEY_PEM
          ? { appId: env.GITHUB_APP_ID, installationId: env.GITHUB_INSTALLATION_ID, privateKeyPem: env.GITHUB_PRIVATE_KEY_PEM }
          : null
        : env.GITHUB_TOKEN && env.GITHUB_TOKEN.length > 0
          ? { userToken: env.GITHUB_TOKEN }
          : null;

    await startIndexer({
      rpcUrl: env.RPC_URL,
      chainId: env.CHAIN_ID,
      contractAddress: env.CONTRACT_ADDRESS as any,
      github
    });
    app.log.info({ contract: env.CONTRACT_ADDRESS, chainId: env.CHAIN_ID }, "indexer started");
  } else {
    app.log.warn("CONTRACT_ADDRESS is empty; indexer disabled");
  }

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
