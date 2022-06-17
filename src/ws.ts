import { JSONRPCServer, JSONRPCClient, JSONRPCServerAndClient, JSONRPCParams } from "json-rpc-2.0";
import WebSocket from "ws";

type WebSocketPayloadCommon = {
  key: string;
  sessionId: string;
};
export type ConnectorInput = WebSocketPayloadCommon & {
  credentials: unknown;
  fields: unknown;
};
export type ConnectorOutput = WebSocketPayloadCommon & {
  payload: unknown;
};

export class JsonRpcWebSocket {
  private serverAndClient: JSONRPCServerAndClient;
  private ws: WebSocket;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.serverAndClient = new JSONRPCServerAndClient(
      new JSONRPCServer(),
      new JSONRPCClient(async (request) => {
        this.ws.send(JSON.stringify(request));
      })
    );
    this.ws.onmessage = (event) => {
      this.serverAndClient.receiveAndSend(JSON.parse(event.data.toString()));
    };
    this.ws.onclose = (event) => {
      this.serverAndClient.rejectAllPendingRequests(`Connection is closed (${event.reason}).`);
    };
    this.ws.onerror = (e) => {
      console.error("WebSocket error:", e);
      this.ws.close();
      this.serverAndClient.rejectAllPendingRequests(`Connection error: ${e.toString()}`);
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addMethod<T extends Record<string, unknown>>(name: string, method: (params: T | undefined) => PromiseLike<any>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.serverAndClient.addMethod(name, method as any);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request<T extends JSONRPCParams, U = unknown>(method: string, params?: T, clientParams?: any): PromiseLike<U> {
    return this.serverAndClient.timeout(10000).request(method, params, clientParams);
  }
  close() {
    this.ws.close();
  }
}
