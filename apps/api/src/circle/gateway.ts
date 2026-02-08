import type { Hex } from "viem";

export type GatewayInfoResponse = {
  domains: Array<{
    domain: string;
    chain: string;
    network: string;
    walletContract: string;
    minterContract: string;
    rpcUrl?: string;
    attestationApi?: string;
    supportedTokens?: string[];
  }>;
};

export type GatewayEstimateRequest = {
  spec: Record<string, unknown>;
  maxBlockHeight?: string;
  maxFee?: string;
};

export type GatewayEstimateResponse =
  | {
      burnIntent: Record<string, unknown>;
    }
  | Array<{
      burnIntent: Record<string, unknown>;
    }>;

export type GatewayTransferRequest = {
  burnIntent: Record<string, unknown>;
  signature: Hex;
};

export type GatewayTransferResponse =
  | {
      attestation: Hex;
      signature: Hex;
    }
  | Array<{
      attestation: Hex;
      signature: Hex;
    }>;

async function gatewayFetch<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const url = `${baseUrl.replace(/\/+$/, "")}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    const msg =
      typeof json?.error === "string"
        ? json.error
        : typeof json?.message === "string"
          ? json.message
          : res.statusText;
    const details = json ? ` :: ${JSON.stringify(json)}` : "";
    throw new Error(`Gateway API error (${res.status}): ${msg}${details}`);
  }
  return json as T;
}

export function createGatewayClient(opts: { baseUrl: string }) {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  return {
    getInfo: async () => gatewayFetch<GatewayInfoResponse>(baseUrl, "/v1/info", { method: "GET" }),
    estimate: async (body: GatewayEstimateRequest) => {
      const res = await gatewayFetch<GatewayEstimateResponse>(baseUrl, "/v1/estimate", {
        method: "POST",
        body: JSON.stringify([{ ...body }])
      });
      if (Array.isArray(res)) return res[0];
      return res;
    },
    transfer: async (body: GatewayTransferRequest) => {
      const res = await gatewayFetch<GatewayTransferResponse>(baseUrl, "/v1/transfer", {
        method: "POST",
        body: JSON.stringify([{ ...body }])
      });
      if (Array.isArray(res)) return res[0];
      return res;
    }
  };
}
