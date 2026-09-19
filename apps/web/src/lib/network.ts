export type AppNetwork = {
  chainId: number;
  contractAddress: `0x${string}`;
  name?: string;
  publicRpcUrls?: string[];
};

let selected: AppNetwork | null = null;

export function networkKey(network: AppNetwork) {
  return `${network.chainId}:${network.contractAddress.toLowerCase()}`;
}

export function networkParams(network: AppNetwork) {
  return {
    chainId: network.chainId,
    contractAddress: network.contractAddress.toLowerCase(),
  };
}

export function networkQuery(network: AppNetwork) {
  return new URLSearchParams({
    chainId: String(network.chainId),
    contractAddress: network.contractAddress.toLowerCase(),
  }).toString();
}

export function selectNetwork(network: AppNetwork) {
  // New identity invalidates operations even when switching A -> B -> A.
  selected = { ...network };
  return selected;
}

export function assertActiveNetwork(network: AppNetwork) {
  if (selected !== network)
    throw new Error(
      "Network selection changed. Please retry on the selected network.",
    );
}

export function clearNetwork() {
  selected = null;
}

export function chooseNetwork(
  networks: AppNetwork[],
  search: string,
  storedKey?: string | null,
) {
  const query = new URLSearchParams(search);
  const chainId = query.get("chainId");
  const contractAddress = query.get("contractAddress");
  if (chainId !== null || contractAddress !== null) {
    const match = networks.find(
      (n) =>
        String(n.chainId) === chainId &&
        n.contractAddress.toLowerCase() === contractAddress?.toLowerCase(),
    );
    if (!match)
      throw new Error(
        "This link refers to an unavailable network. Return to the bounty list to choose a network.",
      );
    return match;
  }
  return (
    networks.find((n) => networkKey(n) === storedKey) ?? networks[0] ?? null
  );
}
