import WebSocket from "ws";
import * as Sentry from "@sentry/node";

type WebSocketPayloadCommon = {
  key: string;
  sessionId: string;
};
export type ConnectorInput<T = unknown> = WebSocketPayloadCommon & {
  credentials: unknown;
  fields: T;
};
export type ConnectorOutput = WebSocketPayloadCommon & {
  payload: unknown;
};
function createStopper() {
  let resolve;
  const promise: Promise<unknown> & { stop?: () => void } = new Promise((res) => {
    resolve = res;
  });
  promise.stop = () => resolve();
  return promise;
}

export abstract class TriggerBase<T = unknown> {
  private running = false;
  protected fields: T;
  private stopper = createStopper();
  constructor(private ws: WebSocket, private input: ConnectorInput) {
    this.fields = input.fields as T;
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.on("close", () => {
      this.stop();
    });
    ws.on("error", () => {
      this.stop();
    });
  }
  isRunning() {
    return this.running;
  }
  stop() {
    this.running = false;
    this.stopper.stop?.();
  }
  async waitForStop() {
    await this.stopper;
  }
  sendNotification(payload: unknown) {
    if (!this.running) {
      return;
    }
    this.ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "notifySignal",
        params: { key: this.input.key, sessionId: this.input.sessionId, payload },
      })
    );
  }
  start() {
    this.running = true;
    this.main().catch((e) => {
      console.error(e);
      Sentry.captureException(e);
    });
  }
  abstract main(): Promise<unknown>;
}
