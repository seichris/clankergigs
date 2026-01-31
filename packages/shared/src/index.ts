import { keccak256, stringToHex, concatBytes, toBytes } from "viem";

export function normalizeRepoId(repoId: string): string {
  // Accept "owner/repo" or "github.com/owner/repo" or full URL.
  const trimmed = repoId.trim();
  const withoutProto = trimmed.replace(/^https?:\/\//, "");
  const withoutHost = withoutProto.replace(/^www\./, "");

  if (withoutHost.startsWith("github.com/")) return withoutHost;
  if (withoutHost.includes("/")) return `github.com/${withoutHost.replace(/^\/+/, "")}`;
  return `github.com/${withoutHost}`;
}

export function repoHash(repoId: string): `0x${string}` {
  const norm = normalizeRepoId(repoId);
  return keccak256(stringToHex(norm));
}

// Must match solidity: keccak256(abi.encodePacked(repoHash, issueNumber))
export function bountyId(repoHashHex: `0x${string}`, issueNumber: bigint): `0x${string}` {
  const repoBytes = toBytes(repoHashHex);
  // uint256 big-endian 32 bytes
  const issueBytes = toBytes(issueNumber, { size: 32 });
  return keccak256(concatBytes([repoBytes, issueBytes]));
}

export * from "./addresses";
