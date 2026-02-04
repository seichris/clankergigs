export const USDC = {
  mainnet: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  sepolia: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  baseSepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  arbitrumSepolia: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  opSepolia: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
  arcTestnet: "0x3600000000000000000000000000000000000000"
} as const;

export function usdcAddressForChainId(chainId: number): string | null {
  if (chainId === 1) return USDC.mainnet;
  if (chainId === 11155111) return USDC.sepolia;
  if (chainId === 84532) return USDC.baseSepolia;
  if (chainId === 421614) return USDC.arbitrumSepolia;
  if (chainId === 11155420) return USDC.opSepolia;
  if (chainId === 5042002) return USDC.arcTestnet;
  return null;
}
