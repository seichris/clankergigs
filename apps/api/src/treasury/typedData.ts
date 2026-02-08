import crypto from "node:crypto";
import { z } from "zod";
import type { Address, Hex } from "viem";
import { addressToBytes32 } from "./config.js";

export const BurnIntentSchema = z.object({
  maxBlockHeight: z.string().regex(/^\d+$/),
  maxFee: z.string().regex(/^\d+$/),
  spec: z.object({
    version: z.union([z.string(), z.number()]),
    sourceDomain: z.union([z.string().regex(/^\d+$/), z.number()]),
    destinationDomain: z.union([z.string().regex(/^\d+$/), z.number()]),
    sourceContract: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    destinationContract: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    sourceToken: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    destinationToken: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    sourceDepositor: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    destinationRecipient: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    sourceSigner: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    destinationCaller: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    value: z.string().regex(/^\d+$/),
    salt: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    hookData: z.string().regex(/^0x[a-fA-F0-9]*$/)
  })
});

export type BurnIntent = z.infer<typeof BurnIntentSchema>;

export function randomSalt32(): Hex {
  return (`0x${crypto.randomBytes(32).toString("hex")}` as Hex);
}

export function buildBurnIntentTypedData(burnIntent: BurnIntent) {
  // Match Circle Gateway docs (GatewayWallet / BurnIntent / TransferSpec).
  return {
    domain: { name: "GatewayWallet", version: "1" },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" }
      ],
      TransferSpec: [
        { name: "version", type: "string" },
        { name: "sourceDomain", type: "uint32" },
        { name: "destinationDomain", type: "uint32" },
        { name: "sourceContract", type: "bytes32" },
        { name: "destinationContract", type: "bytes32" },
        { name: "sourceToken", type: "bytes32" },
        { name: "destinationToken", type: "bytes32" },
        { name: "sourceDepositor", type: "bytes32" },
        { name: "destinationRecipient", type: "bytes32" },
        { name: "sourceSigner", type: "bytes32" },
        { name: "destinationCaller", type: "bytes32" },
        { name: "value", type: "uint256" },
        { name: "salt", type: "bytes32" },
        { name: "hookData", type: "bytes" }
      ],
      BurnIntent: [
        { name: "maxBlockHeight", type: "uint256" },
        { name: "maxFee", type: "uint256" },
        { name: "spec", type: "TransferSpec" }
      ]
    },
    primaryType: "BurnIntent" as const,
    message: burnIntent
  };
}

export function buildSourcePartyBytes32(sender: Address) {
  const b32 = addressToBytes32(sender);
  return { sourceDepositor: b32, sourceSigner: b32 };
}

export function buildDestinationPartyBytes32(opts: { treasuryAddress: Address; destinationCaller: Address }) {
  return {
    destinationRecipient: addressToBytes32(opts.treasuryAddress),
    destinationCaller: addressToBytes32(opts.destinationCaller)
  };
}
