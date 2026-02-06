export type JsonRpcError = { code?: number; message?: string; data?: unknown };
export type JsonRpcResponse<T> =
  | { jsonrpc: "2.0"; id: number; result: T }
  | { jsonrpc: "2.0"; id: number; error: JsonRpcError };

export async function suiRpc<T>(rpcUrl: string, method: string, params: unknown) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  const json = (await res.json().catch(() => null)) as JsonRpcResponse<T> | null;
  if (!res.ok || !json) throw new Error(`Sui RPC error (${res.status}): ${res.statusText}`);
  if ("error" in json) {
    const msg = typeof json.error?.message === "string" ? json.error.message : "Unknown error";
    throw new Error(`Sui RPC ${method} failed: ${msg}`);
  }
  return json.result;
}

export type SuiEventId = { txDigest: string; eventSeq: string };

export type SuiEvent = {
  id: SuiEventId;
  packageId: string;
  transactionModule: string;
  sender?: string;
  type: string;
  parsedJson?: unknown;
  timestampMs?: string;
};

export type QueryEventsResult = {
  data: SuiEvent[];
  nextCursor: SuiEventId | null;
  hasNextPage: boolean;
};

export async function queryEventsByPackage(opts: {
  rpcUrl: string;
  packageId: string;
  cursor: SuiEventId | null;
  limit: number;
}) {
  // Sui RPC expects positional params:
  //   suix_queryEvents(filter, cursor, limit, descending_order)
  // And filter is a tagged-union like { MoveEventModule: { package, module } }.
  return suiRpc<QueryEventsResult>(opts.rpcUrl, "suix_queryEvents", [
    { MoveEventModule: { package: opts.packageId, module: "gh_bounties" } },
    opts.cursor,
    opts.limit,
    false
  ]);
}

export type SuiObjectResponse = {
  data?: {
    content?: {
      dataType: "moveObject";
      type: string;
      fields?: Record<string, unknown>;
    };
  };
  error?: JsonRpcError;
};

export async function getObject(opts: { rpcUrl: string; objectId: string }) {
  return suiRpc<SuiObjectResponse>(opts.rpcUrl, "sui_getObject", [opts.objectId, { showContent: true }]);
}
