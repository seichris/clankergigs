export const USDC = {
  // Mainnet
  mainnet: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  // Testnets (Gateway-supported)
  sepolia: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  avalancheFuji: "0x5425890298aed601595a70AB815c96711a31Bc65",
  baseSepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  sonicBlaze: "0xA4879Fed32Ecbef99399e5cbC247E533421C4eC6",
  worldChainSepolia: "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88",
  seiAtlantic: "0x4fCF1784B31630811181f670Aea7A7bEF803eaED",
  hyperEvmTestnet: "0x2B3370eE501B4a559b57D449569354196457D8Ab",
  arcTestnet: "0x3600000000000000000000000000000000000000",
  // Testnets (CCTP-only, not Gateway)
  arbitrumSepolia: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  opSepolia: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
} as const;

export function usdcAddressForChainId(chainId: number): string | null {
  // Mainnet
  if (chainId === 1) return USDC.mainnet;
  // Testnets (Gateway-supported)
  if (chainId === 11155111) return USDC.sepolia;           // Ethereum Sepolia
  if (chainId === 43113) return USDC.avalancheFuji;        // Avalanche Fuji
  if (chainId === 84532) return USDC.baseSepolia;          // Base Sepolia
  if (chainId === 57054) return USDC.sonicBlaze;           // Sonic Blaze Testnet
  if (chainId === 4801) return USDC.worldChainSepolia;     // World Chain Sepolia
  if (chainId === 1328) return USDC.seiAtlantic;           // Sei Atlantic-2
  if (chainId === 998) return USDC.hyperEvmTestnet;        // HyperEVM Testnet
  if (chainId === 5042002) return USDC.arcTestnet;         // Arc Testnet
  // Testnets (CCTP-only, not Gateway)
  if (chainId === 421614) return USDC.arbitrumSepolia;
  if (chainId === 11155420) return USDC.opSepolia;
  return null;
}
