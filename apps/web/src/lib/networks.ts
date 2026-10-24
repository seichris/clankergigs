import type { Address } from "viem";

export type Deployment = { chainId: number; contractAddress: Address };

export function deploymentKey(network: Deployment) {
  return `${network.chainId}:${network.contractAddress.toLowerCase()}`;
}

export function networkQuery(network: Deployment | null) {
  if (!network) throw new Error("Select an available network first");
  return new URLSearchParams({
    chainId: String(network.chainId),
    contractAddress: network.contractAddress,
  }).toString();
}

export function parseDeployments(value: unknown): Deployment[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("No deployments available");
  const keys = new Set<string>();
  return value.map((item) => {
    if (
      !Number.isSafeInteger(item?.chainId) ||
      item.chainId <= 0 ||
      typeof item.contractAddress !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(item.contractAddress)
    ) {
      throw new Error("Invalid network discovery response");
    }
    const network: Deployment = {
      chainId: item.chainId,
      contractAddress: item.contractAddress.toLowerCase() as Address,
    };
    const key = deploymentKey(network);
    if (keys.has(key)) throw new Error("Duplicate network discovery response");
    keys.add(key);
    return network;
  });
}

// Browser-only session identity, not just a chain ID. A -> B -> A must also
// invalidate an async operation that started before the first switch.
let activeNetwork: Deployment | null = null;
export function activateNetwork(network: Deployment | null) {
  activeNetwork = network ? { ...network } : null;
  return activeNetwork;
}

export function isActiveNetwork(network: Deployment | null) {
  return Boolean(network && network === activeNetwork);
}

export function assertActiveNetwork(
  network: Deployment | null,
): asserts network is Deployment {
  if (!network || network !== activeNetwork)
    throw new Error(
      "Network selection changed. Review the selected deployment and retry.",
    );
}
