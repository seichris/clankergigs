import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export async function gatewayMintOnArc(opts: {
  rpcUrl: string;
  chainId: number;
  minterContract: Address;
  destinationCallerPrivateKey: Hex;
  attestation: Hex;
  signature: Hex;
}) {
  const account = privateKeyToAccount(opts.destinationCallerPrivateKey);
  const chain = {
    id: opts.chainId,
    name: `Arc ${opts.chainId}`,
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [opts.rpcUrl] } }
  } as const;

  const transport = http(opts.rpcUrl);
  const pc = createPublicClient({ chain, transport });
  const wc = createWalletClient({ chain, transport, account });

  const abi = parseAbi(["function gatewayMint(bytes payload, bytes signature) external"]);

  const hash = await wc.writeContract({
    address: opts.minterContract,
    abi,
    functionName: "gatewayMint",
    args: [opts.attestation, opts.signature]
  });

  await pc.waitForTransactionReceipt({ hash });
  return { hash };
}

