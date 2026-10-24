import { createPublicClient, fallback, http, type Address } from "viem";
import { z } from "zod";
import type { PrismaClient } from "./generated/prisma/index.js";

const address = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .transform((value) => value.toLowerCase() as Address);
const chainId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const networkSchema = z.object({
  chainId,
  contractAddress: address,
  rpcUrls: z
    .array(
      z
        .string()
        .url()
        .refine((value) => /^https?:\/\//i.test(value)),
    )
    .min(1),
  startBlock: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
});

export type NetworkConfig = z.infer<typeof networkSchema>;
export type Network = NetworkConfig & {
  key: string;
  rpcTransport: ReturnType<typeof http> | ReturnType<typeof fallback>;
  publicClient: ReturnType<typeof createPublicClient>;
};
export type NetworkRegistry = Map<string, Network>;

export function networkKey(network: {
  chainId: number;
  contractAddress: string;
}) {
  return `${network.chainId}:${network.contractAddress.toLowerCase()}`;
}

/** Invalid preferred configuration must never silently select a legacy chain. */
export function parseNetworks(
  raw: string | undefined,
  legacy: {
    CHAIN_ID: number;
    CONTRACT_ADDRESS?: string;
    RPC_URLS: string[];
    INDEXER_START_BLOCK?: number;
  },
): NetworkConfig[] {
  let input: unknown;
  if (raw?.trim()) {
    try {
      input = JSON.parse(raw);
    } catch {
      throw new Error("NETWORKS_JSON must be a JSON array");
    }
  } else {
    input = legacy.CONTRACT_ADDRESS
      ? [
          {
            chainId: legacy.CHAIN_ID,
            contractAddress: legacy.CONTRACT_ADDRESS,
            rpcUrls: legacy.RPC_URLS,
            startBlock: legacy.INDEXER_START_BLOCK,
          },
        ]
      : [];
  }
  const result = z.array(networkSchema).safeParse(input);
  // Do not echo RPC URLs: they may contain provider credentials.
  if (!result.success)
    throw new Error(
      "Invalid network configuration: expected safe chain IDs, EVM addresses and non-empty HTTP(S) rpcUrls",
    );
  if (raw?.trim() && result.data.length === 0)
    throw new Error("NETWORKS_JSON must contain at least one network");
  const seen = new Set<string>();
  for (const network of result.data) {
    const key = networkKey(network);
    if (seen.has(key)) throw new Error(`Duplicate deployment: ${key}`);
    seen.add(key);
  }
  return result.data;
}

export function createNetworkRegistry(
  configs: NetworkConfig[],
): NetworkRegistry {
  return new Map(
    configs.map((config) => {
      const rpcTransport =
        config.rpcUrls.length > 1
          ? fallback(config.rpcUrls.map((url) => http(url)))
          : http(config.rpcUrls[0]);
      const key = networkKey(config);
      return [
        key,
        {
          ...config,
          key,
          rpcTransport,
          publicClient: createPublicClient({ transport: rpcTransport }),
        },
      ];
    }),
  );
}

export function publicNetworks(registry: NetworkRegistry) {
  return [...registry.values()].map(({ chainId, contractAddress }) => ({
    chainId,
    contractAddress,
  }));
}

export class NetworkRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

/** A supplied selector is always a complete deployment, including same-chain contracts. */
export function networkSelector(input: {
  chainId?: unknown;
  contractAddress?: unknown;
}) {
  if (input.chainId === undefined && input.contractAddress === undefined)
    return undefined;
  if (input.chainId === undefined || input.contractAddress === undefined) {
    throw new NetworkRequestError("Provide both chainId and contractAddress");
  }
  const number =
    typeof input.chainId === "string" && /^\d+$/.test(input.chainId)
      ? Number(input.chainId)
      : input.chainId;
  const parsed = z
    .object({ chainId, contractAddress: address })
    .safeParse({ ...input, chainId: number });
  if (!parsed.success)
    throw new NetworkRequestError("Invalid chainId or contractAddress");
  return parsed.data;
}

export function configuredNetwork(
  registry: NetworkRegistry,
  selector: { chainId: number; contractAddress: string },
) {
  const network = registry.get(networkKey(selector));
  if (!network)
    throw new NetworkRequestError("Deployment is not configured", 404);
  return network;
}

export async function resolveBountyNetwork(
  registry: NetworkRegistry,
  prisma: Pick<PrismaClient, "bounty">,
  input: { chainId?: unknown; contractAddress?: unknown },
  bountyId: string,
) {
  const selected = networkSelector(input);
  if (selected) return configuredNetwork(registry, selected);
  const matches: Array<{ chainId: number; contractAddress: string }> =
    await prisma.bounty.findMany({
      where: { bountyId },
      select: { chainId: true, contractAddress: true },
      take: 2,
    });
  if (matches.length > 1)
    throw new NetworkRequestError(
      "Ambiguous bountyId: provide chainId and contractAddress",
      409,
    );
  if (matches.length === 1) return configuredNetwork(registry, matches[0]!);
  if (registry.size === 1) return [...registry.values()][0]!;
  throw new NetworkRequestError("Provide chainId and contractAddress", 409);
}
