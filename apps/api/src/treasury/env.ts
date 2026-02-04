import { isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_TESTNET } from "./config.js";

export type TreasuryEnv =
  | { enabled: false }
  | {
      enabled: true;
      gatewayApiUrl: string;
      arc: { chainId: number; rpcUrl: string; usdcAddress: Address; domain: number };
      treasuryAddress: Address;
      destinationCallerPrivateKey: Hex;
      destinationCallerAddress: Address;
      circleWallets?: { apiKey: string; entitySecret: string; baseUrl?: string };
      orchestrator: { enabled: boolean; intervalMs: number };
    };

export function loadTreasuryEnvFromProcess(): TreasuryEnv {
  const enabled = process.env.TREASURY_ENABLED === "1";
  if (!enabled) return { enabled: false };

  const gatewayApiUrl = (process.env.CIRCLE_GATEWAY_API_URL || "https://gateway-api-testnet.circle.com").trim();
  const arcChainId = Number(process.env.TREASURY_ARC_CHAIN_ID || ARC_TESTNET.chainId);
  const arcRpcUrl = (process.env.TREASURY_ARC_RPC_URL || ARC_TESTNET.rpcUrl).trim();
  const treasuryAddressRaw = (process.env.TREASURY_ADDRESS || "").trim();
  const destinationCallerPkRaw = (process.env.TREASURY_DESTINATION_CALLER_PRIVATE_KEY || "").trim();
  const circleApiKey = (process.env.CIRCLE_API_KEY || "").trim();
  const circleEntitySecret = (process.env.CIRCLE_ENTITY_SECRET || "").trim();
  const circleWalletsBaseUrl = (process.env.CIRCLE_WALLETS_BASE_URL || "").trim();

  if (!gatewayApiUrl) throw new Error("Missing CIRCLE_GATEWAY_API_URL");
  if (!arcRpcUrl) throw new Error("Missing TREASURY_ARC_RPC_URL");
  if (!treasuryAddressRaw || !isAddress(treasuryAddressRaw)) throw new Error("Missing TREASURY_ADDRESS");
  if (!destinationCallerPkRaw) throw new Error("Missing TREASURY_DESTINATION_CALLER_PRIVATE_KEY");

  const destinationCallerAddress = privateKeyToAccount(destinationCallerPkRaw as Hex).address;
  if (destinationCallerAddress.toLowerCase() !== treasuryAddressRaw.toLowerCase()) {
    throw new Error("TREASURY_ADDRESS must match TREASURY_DESTINATION_CALLER_PRIVATE_KEY address (MVP constraint)");
  }

  const orchestratorEnabled = (process.env.TREASURY_ORCHESTRATOR_ENABLED || "1") === "1";
  const intervalMsRaw = Number(process.env.TREASURY_ORCHESTRATOR_INTERVAL_MS || "2500");
  const intervalMs = Number.isFinite(intervalMsRaw) ? Math.max(250, Math.floor(intervalMsRaw)) : 2500;

  const circleWallets =
    circleApiKey && circleEntitySecret
      ? { apiKey: circleApiKey, entitySecret: circleEntitySecret, baseUrl: circleWalletsBaseUrl || undefined }
      : undefined;

  return {
    enabled: true,
    gatewayApiUrl,
    arc: { chainId: arcChainId, rpcUrl: arcRpcUrl, usdcAddress: ARC_TESTNET.usdcAddress, domain: ARC_TESTNET.gatewayDestinationDomain },
    treasuryAddress: treasuryAddressRaw as Address,
    destinationCallerPrivateKey: destinationCallerPkRaw as Hex,
    destinationCallerAddress,
    circleWallets,
    orchestrator: { enabled: orchestratorEnabled, intervalMs }
  };
}
