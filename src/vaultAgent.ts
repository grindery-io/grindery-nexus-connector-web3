import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { JSONRPCRequest, JSONRPCResponse } from "json-rpc-2.0";

const auth = new GoogleAuth();
let client: OAuth2Client;

const VAULT_AGENT_URL = process.env.VAULT_AGENT_URL || "";

async function getClient() {
  if (!client) {
    try {
      client = await auth.getIdTokenClient(VAULT_AGENT_URL);
    } catch (e) {
      console.warn("Can't get idTokenClient, falling back to regular client");
      client = (await auth.getClient()) as OAuth2Client;
    }
  }
  return client;
}

export async function callVault<T = unknown>(method: string, params = {}): Promise<T> {
  const client = await getClient();
  try {
    const resp = await client.request<JSONRPCResponse>({
      url: VAULT_AGENT_URL,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: "1" } as JSONRPCRequest),
    });
    if (resp.data.error) {
      throw new Error(resp.data.error?.message || resp.data.error.toString());
    }
    return resp.data.result as T;
  } catch (e) {
    if (e.response?.data?.error) {
      throw new Error(e.response.data.error?.message || e.response.data.error.toString());
    }
    throw e;
  }
}
const cache = new Map<string, unknown>();
export async function callVaultWithCache<T = unknown>(method: string): Promise<T> {
  if (!cache.has(method)) {
    cache.set(method, await callVault(method));
  }
  return cache.get(method) as T;
}
