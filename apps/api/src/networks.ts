import { createPublicClient, fallback, http, type Address } from "viem";
import { z } from "zod";
import type { Env } from "./env.js";

const address = z
  .string()
  .regex(/^0x[\da-fA-F]{40}$/)
  .transform((v) => v.toLowerCase() as Address);
const rpcUrl = z
  .string()
  .url()
  .refine((v) => /^https?:\/\//i.test(v), "Expected HTTP(S) RPC URL");
const networkSchema = z.object({
  chainId: z.number().int().positive().max(2147483647),
  contractAddress: address,
  rpcUrls: z.array(rpcUrl).min(1),
  // Only explicitly public endpoints are sent to browsers. Server RPCs may contain secrets.
  publicRpcUrls: z.array(rpcUrl).default([]),
  name: z.string().min(1).optional(),
  startBlock: z.number().int().nonnegative().optional(),
});

export type NetworkConfig = z.infer<typeof networkSchema>;
export type NetworkSelection = { chainId?: unknown; contractAddress?: unknown };
export class NetworkError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
  ) {
    super(message);
  }
}

export function networkKey(n: { chainId: number; contractAddress: string }) {
  return `${n.chainId}:${n.contractAddress.toLowerCase()}`;
}

export function createNetworkRegistry(
  env: Pick<
    Env,
    | "NETWORKS_JSON"
    | "CHAIN_ID"
    | "CONTRACT_ADDRESS"
    | "RPC_URLS"
    | "INDEXER_START_BLOCK"
  >,
) {
  let raw: unknown;
  if (env.NETWORKS_JSON?.trim()) {
    try {
      raw = JSON.parse(env.NETWORKS_JSON);
    } catch {
      throw new Error("NETWORKS_JSON must be a JSON array");
    }
  } else {
    raw = env.CONTRACT_ADDRESS
      ? [
          {
            chainId: env.CHAIN_ID,
            contractAddress: env.CONTRACT_ADDRESS,
            rpcUrls: env.RPC_URLS,
            startBlock: env.INDEXER_START_BLOCK,
          },
        ]
      : [];
  }
  const result = z.array(networkSchema).safeParse(raw);
  if (!result.success) {
    // Do not include input values (RPC URLs can contain API keys).
    throw new Error(
      `Invalid network configuration: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  const seen = new Set<string>();
  const networks = result.data.map((config) => {
    const key = networkKey(config);
    if (seen.has(key)) throw new Error(`Duplicate network: ${key}`);
    seen.add(key);
    const rpcTransport =
      config.rpcUrls.length > 1
        ? fallback(config.rpcUrls.map((url) => http(url)))
        : http(config.rpcUrls[0]);
    return {
      ...config,
      key,
      rpcTransport,
      publicClient: createPublicClient({ transport: rpcTransport }),
    };
  });
  return networks;
}

export type NetworkRegistry = ReturnType<typeof createNetworkRegistry>;
export type Network = NetworkRegistry[number];

export function publicNetworks(networks: NetworkRegistry) {
  return networks.map(({ chainId, contractAddress, name, publicRpcUrls }) => ({
    chainId,
    contractAddress,
    name,
    publicRpcUrls,
  }));
}

function parseSelection(input: NetworkSelection) {
  let chainId: number | undefined;
  let contractAddress: Address | undefined;
  if (input.chainId !== undefined) {
    if (
      !/^[1-9]\d*$/.test(String(input.chainId)) ||
      !Number.isSafeInteger(Number(input.chainId))
    )
      throw new NetworkError("Invalid chainId");
    chainId = Number(input.chainId);
  }
  if (input.contractAddress !== undefined) {
    const parsed = address.safeParse(input.contractAddress);
    if (!parsed.success) throw new NetworkError("Invalid contractAddress");
    contractAddress = parsed.data;
  }
  return { chainId, contractAddress };
}

export function matchingNetworks(
  networks: NetworkRegistry,
  input: NetworkSelection,
) {
  const { chainId, contractAddress } = parseSelection(input);
  const matches = networks.filter(
    (n) =>
      (chainId === undefined || n.chainId === chainId) &&
      (contractAddress === undefined || n.contractAddress === contractAddress),
  );
  if (
    (chainId !== undefined || contractAddress !== undefined) &&
    !matches.length
  )
    throw new NetworkError("Network is not configured");
  return matches;
}

export function networkWhere(
  networks: NetworkRegistry,
  input: NetworkSelection = {},
) {
  return {
    OR: matchingNetworks(networks, input).map(
      ({ chainId, contractAddress }) => ({ chainId, contractAddress }),
    ),
  };
}

// Single-network clients remain compatible; multi-network writes require the full pair.
export function resolveNetwork(
  networks: NetworkRegistry,
  input: NetworkSelection,
) {
  if ((input.chainId === undefined) !== (input.contractAddress === undefined))
    throw new NetworkError("Provide both chainId and contractAddress");
  const matches = matchingNetworks(networks, input);
  if (!matches.length) throw new NetworkError("No networks configured", 503);
  if (matches.length > 1)
    throw new NetworkError(
      "Ambiguous network: provide chainId and contractAddress",
      409,
    );
  return matches[0]!;
}

export async function verifyNetwork(network: Network) {
  if ((await network.publicClient.getChainId()) !== network.chainId)
    throw new NetworkError("Configured RPC chainId mismatch", 503);
}
