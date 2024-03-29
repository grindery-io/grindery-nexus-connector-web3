import Web3 from "web3";
import { BlockTransactionObject } from "web3-eth";
import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { trackSingle } from "../../metric";
import { NewBlockSubscriber } from "./newBlockSubscriber";

function instrumentProvider<T extends { send: (payload, callback) => void }>(
  provider: T,
  extraTags: Record<string, string>
): T {
  const originalSend = provider.send;
  provider.send = function (payload) {
    for (const request of Array.isArray(payload) ? payload : [payload]) {
      if (!request.method) {
        console.log("instrumentProvider: Unexpected payload", { payload });
        continue;
      }
      if (request.method === "eth_sign") {
        console.warn(`Unexpected call to ${request.method}`, { request }, new Error("For stack trace"));
      }
      trackSingle("web3ApiCalls", { ...extraTags, method: request.method });
    }
    // eslint-disable-next-line prefer-rest-params, @typescript-eslint/no-explicit-any
    return originalSend.apply(this, arguments as any);
  };
  return provider;
}
export class Web3Wrapper extends EventEmitter {
  private ref = 1;
  public readonly web3: Web3;
  private readonly web3Full: Web3 | undefined;
  private provider: InstanceType<typeof Web3.providers.WebsocketProvider> | undefined;
  private newBlockSubscriber: null | NewBlockSubscriber = null;
  private reconnectTimer: null | ReturnType<typeof setTimeout> = null;
  private reconnectCount = 0;
  constructor(private url: string | null, private urlHttp: string, private chainId: string) {
    super();
    this.setMaxListeners(1000);
    console.log(`[${this.logTag()}] Creating web3 wrapper`);
    if (url) {
      this.provider = this.createProvider();
      if (!this.provider) {
        throw new Error("Unexpected null provider");
      }
      this.web3Full = new Web3(this.provider);
    } else {
      console.log(`[${this.logTag()}] WebSocket is disabled`);
    }
    this.web3 = new Web3(
      instrumentProvider(new Web3.providers.HttpProvider(urlHttp, { timeout: 15000 }), {
        chainId: this.chainId,
        type: "http",
      })
    );
  }

  private createProvider() {
    if (!this.url) {
      return;
    }
    this.provider = instrumentProvider(
      new Web3.providers.WebsocketProvider(this.url, {
        timeout: 15000,
        reconnect: {
          auto: false,
        },
        clientConfig: {
          maxReceivedFrameSize: 4000000,
          maxReceivedMessageSize: 16000000,
        },
      }),
      {
        chainId: this.chainId,
        type: "ws",
      }
    );
    this.provider.on("error", ((e) => {
      console.error("WS provider error", e);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);
    return this.provider;
  }

  logTag() {
    return `${this.chainId}-${this.urlHttp.replace(/([0-9a-f-]{8,}|[0-9a-z_-]{20,})/gi, "***")}`;
  }

  close() {
    if (this.ref <= 0) {
      return;
    }
    this.ref--;
    if (this.ref <= 0) {
      console.log(`[${this.logTag()}] Closing web3 wrapper`);
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      if (this.newBlockSubscriber) {
        this.newBlockSubscriber.close();
        this.newBlockSubscriber = null;
      }
      this.web3.eth.clearSubscriptions(() => {
        /* Ignore */
      });
      this.web3.setProvider(null);
      this.web3Full?.setProvider(null);
      this.provider?.reset();
      this.provider?.disconnect();
      this.emit("close");
      this.removeAllListeners();
    }
  }

  isClosed() {
    return this.ref <= 0;
  }

  addRef() {
    if (this.ref <= 0) {
      throw new Error("Web3Wrapper already closed");
    }
    this.ref++;
  }

  private reconnectProvider() {
    if (this.isClosed()) {
      return;
    }
    if (this.reconnectTimer) {
      return;
    }
    if (!this.url) {
      return;
    }
    if (!this.provider) {
      throw new Error("Unexpected null provider");
    }
    this.reconnectCount++;
    const reconnectCount = this.reconnectCount;
    if (this.provider.connection && this.provider.connection.readyState === WebSocket.OPEN) {
      this.provider.connection.close();
    }
    this.reconnectTimer = setTimeout(() => {
      if (this.reconnectCount !== reconnectCount) {
        return;
      }
      this.reconnectTimer = null;
      if (!this.provider) {
        throw new Error("Unexpected null provider");
      }
      if (this.provider.connection && this.provider.connection.readyState === WebSocket.OPEN) {
        this.provider.connection.close();
      }
      if (this.isClosed()) {
        return;
      }
      setTimeout(() => {
        if (this.reconnectCount !== reconnectCount) {
          return;
        }
        if (this.isClosed()) {
          return;
        }
        if (!this.provider) {
          throw new Error("Unexpected null provider");
        }
        this.provider.reset();
        this.createProvider();
        this.web3Full?.setProvider(this.provider);
        setTimeout(() => {
          if (this.isClosed()) {
            return;
          }
          if (this.reconnectCount === reconnectCount) {
            this.reconnectCount = 0;
          }
        }, 60000);
      }, 100);
    }, 100 * Math.pow(2, this.reconnectCount));
  }

  private subscribeToNewBlockHeader() {
    if (this.isClosed()) {
      return;
    }
    if (!this.reconnectTimer) {
      this.reconnectCount = 0;
    }
    if (!this.newBlockSubscriber) {
      this.newBlockSubscriber = new NewBlockSubscriber(this.web3, this.web3Full || null, this.logTag());
      this.newBlockSubscriber.on("newBlock", (block) => {
        if (this.listenerCount("newBlock") === 0) {
          console.log(`[${this.logTag()}] No listeners for newBlock, closing subscription`);
          this.newBlockSubscriber?.close();
          this.newBlockSubscriber = null;
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const callOnceMemo = new Map<string, any>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const memoCall = function (key: string, call: () => any) {
          if (!callOnceMemo.has(key)) {
            callOnceMemo.set(key, call());
          }
          return callOnceMemo.get(key);
        };
        this.emit("newBlock", block, memoCall);
      });
      this.newBlockSubscriber.on("reconnectProvider", () => {
        console.log(`[${this.logTag()}] Trying to reconnect to WebSocket provider`);
        this.reconnectProvider();
      });
      this.newBlockSubscriber.on("error", (e) => {
        console.error(`[${this.logTag()}] Error in newBlockSubscriber`, e);
      });
      this.newBlockSubscriber.on("stop", (e) => {
        this.emit("error", e);
        this.newBlockSubscriber?.close();
        this.newBlockSubscriber = null;
        this.ref = 1;
        this.close();
      });
    }
  }

  onNewBlock(
    callback: (block: BlockTransactionObject, memoCall: <T>(key: string, call: () => T) => T) => void,
    onError: (e: Error) => void
  ) {
    if (this.isClosed()) {
      throw new Error("Web3Wrapper is closed");
    }
    this.addListener("newBlock", callback);
    this.addListener("error", onError);
    if (!this.newBlockSubscriber) {
      this.subscribeToNewBlockHeader();
    }
    return () => {
      this.removeListener("newBlock", callback);
      this.removeListener("error", onError);
    };
  }
}
