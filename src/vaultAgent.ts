import { GoogleAuth, IdTokenClient } from "google-auth-library";
import { JSONRPCRequest, JSONRPCResponse } from "json-rpc-2.0";

const auth = new GoogleAuth();
let client: IdTokenClient;

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const VAULT_AGENT_URL = process.env.VAULT_AGENT_URL!;

async function getClient() {
  if (!client) {
    client = await auth.getIdTokenClient(VAULT_AGENT_URL);
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
