import type { Address, Hex } from "viem";
import { usdcAddressForChainId } from "@gh-bounties/shared";

export type SupportedSourceChain = {
  chainId: number;
  label: string;
  gatewaySourceDomain: number;
  usdcAddress: Address;
};

export type TreasuryArcConfig = {
  chainId: number;
  rpcUrl: string;
  gatewayDestinationDomain: number;
  usdcAddress: Address;
};

export type GatewayContracts = {
  walletContract: Address;
  minterContract: Address;
};

// Testnet values from Circle Gateway docs.
// If/when you need mainnet support, make these env-configurable.
export const GATEWAY_TESTNET_CONTRACTS: GatewayContracts = {
  walletContract: "0x0077082b6F6B16128C9e0C6d2e2C16c5305c47fE",
  minterContract: "0x0022222ABE238Cc2f7e7eF3Fdd8a49AfaE42F35B"
};

export const GATEWAY_DOMAIN_BY_CHAIN_ID: Record<number, { domain: number; label: string }> = {
  11155111: { domain: 0, label: "Ethereum Sepolia" },
  84532: { domain: 6, label: "Base Sepolia" }
};

export const ARC_TESTNET: TreasuryArcConfig = {
  chainId: 5042002,
  rpcUrl: "https://rpc.testnet.arc.network",
  gatewayDestinationDomain: 26,
  usdcAddress: "0x3600000000000000000000000000000000000000"
};

export function getSupportedSourceChains(): SupportedSourceChain[] {
  const result: SupportedSourceChain[] = [];
  for (const [chainIdRaw, cfg] of Object.entries(GATEWAY_DOMAIN_BY_CHAIN_ID)) {
    const chainId = Number(chainIdRaw);
    const usdc = usdcAddressForChainId(chainId);
    if (!usdc) continue;
    result.push({ chainId, label: cfg.label, gatewaySourceDomain: cfg.domain, usdcAddress: usdc as Address });
  }
  return result;
}

export function addressToBytes32(address: Address): Hex {
  // Left-pad 20-byte address to 32 bytes.
  return (`0x${"0".repeat(24)}${address.slice(2)}`.toLowerCase() as Hex);
}

