import Web3 from "web3";
import { AbiItem } from "web3-utils";
import { Subscription } from "web3-core-subscriptions";
import { BlockTransactionObject } from "web3-eth";
import { EventEmitter } from "node:events";

const CHAIN_MAPPING = {
  "eip155:1": "eth",
  "eip155:42161": "arbitrum",
  "eip155:100": "gnosis",
  "eip155:137": "polygon",
  "eip155:42220": "celo",
  "eip155:43114": "avalanche",
  "eip155:56": "bsc",
  "eip155:250": "fantom",
  "eip155:245022934": "solana",

  "eip155:80001": "wss://rpc-mumbai.matic.today/", // Polygon Mumbai testnet
};
class NewBlockSubscriber extends EventEmitter {
  private newBlockSubscription: null | Subscription<unknown> = null;
  private latestBlock = -1;
  private nextBlock = -1;
  private checking = false;
  private closed = false;
  private pollTimer: null | ReturnType<typeof setTimeout> = null;
  constructor(private web3: Web3) {
    super();
    this.resetSubscription();
    this.resetPoller();
  }
  close() {
    this.closed = true;
    this.removeAllListeners();
    this.unsubscribe();
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }
  unsubscribe() {
    if (this.newBlockSubscription) {
      this.newBlockSubscription.unsubscribe((err) => {
        if (err) {
          console.error("Failed to unsubscribe from newBlockHeaders", err);
        }
      });
    }
    this.newBlockSubscription = null;
  }
  resetSubscription() {
    this.unsubscribe();
    if (this.closed) {
      return;
    }
    this.newBlockSubscription = this.web3.eth
      .subscribe("newBlockHeaders")
      .on("data", (block) => {
        if (!block.number) {
          return;
        }
        this.latestBlock = block.number;
        this.checkNewBlocks().catch((e) => console.error("Error in checkNewBlocks", e));
        this.resetPoller();
      })
      .on("error", (error) => {
        console.error(error);
        this.emit("error", error);
        this.resetSubscription();
      });
  }
  async poll() {
    if (this.closed) {
      return;
    }
    try {
      const latestBlock = await this.web3.eth.getBlockNumber();
      if (latestBlock > this.latestBlock) {
        this.latestBlock = latestBlock;
        console.log(`Got new block from polling: ${latestBlock}`);
        this.checkNewBlocks().catch((e) => console.error("Error in checkNewBlocks", e));
      }
    } catch (e) {
      console.error("Error in poll", e);
    }
    this.resetPoller();
  }
  resetPoller() {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }
    if (this.closed) {
      return;
    }
    this.pollTimer = setTimeout(() => this.poll(), 30000);
  }
  async checkNewBlocks() {
    if (this.nextBlock <= 0) {
      this.nextBlock = this.latestBlock;
      return;
    }
    if (this.checking) {
      return;
    }
    this.checking = true;
    try {
      while (this.nextBlock < this.latestBlock - 3) {
        if (this.closed) {
          return;
        }
        const blockWithTransactions: BlockTransactionObject | undefined = await this.web3.eth
          .getBlock(this.nextBlock, true)
          .catch((e) => {
            if (this.closed) {
              return;
            }
            console.error("Error getting block:", e);
            this.resetSubscription();
            return undefined;
          });
        if (!blockWithTransactions) {
          console.log("No block", this.nextBlock);
          return;
        }
        this.nextBlock++;
        if (!blockWithTransactions.transactions) {
          console.log("No transactions in block", blockWithTransactions.number, blockWithTransactions);
          return;
        }
        this.emit("newBlock", blockWithTransactions);
      }
    } catch (e) {
      console.error("Error in checkNewBlocks", e);
      this.emit("error", e);
    } finally {
      this.checking = false;
    }
  }
}
class Web3Wrapper extends EventEmitter {
  private ref = 1;
  public readonly web3: Web3;
  private newBlockSubscriber: null | NewBlockSubscriber = null;
  constructor(url: string) {
    super();
    this.setMaxListeners(1000);
    console.log("Creating web3 wrapper");
    const provider = new Web3.providers.WebsocketProvider(url, {
      reconnect: {
        auto: true,
        delay: 1000,
        onTimeout: true,
      },
      clientConfig: {
        maxReceivedFrameSize: 4000000,
        maxReceivedMessageSize: 16000000, // bytes - default: 8MiB, current: 16Mib
      },
    });
    provider.on("error", ((e) => {
      console.error("WS provider error", e);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);
    this.web3 = new Web3(provider);
  }
  close() {
    this.ref--;
    if (this.ref <= 0) {
      if (this.newBlockSubscriber) {
        this.newBlockSubscriber.close();
        this.newBlockSubscriber = null;
      }
      const provider = this.web3.currentProvider as InstanceType<typeof Web3.providers.WebsocketProvider>;
      console.log("Closing web3 wrapper");
      this.removeAllListeners();
      this.web3.setProvider(null);
      provider.reset();
      provider.disconnect();
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
  private subscribeToNewBlockHeader() {
    if (this.isClosed()) {
      return;
    }
    if (!this.newBlockSubscriber) {
      this.newBlockSubscriber = new NewBlockSubscriber(this.web3);
      this.newBlockSubscriber.on("newBlock", (block) => {
        if (this.listenerCount("newBlock") === 0) {
          this.newBlockSubscriber?.close();
          this.newBlockSubscriber = null;
          return;
        }
        this.emit("newBlock", block);
      });
    }
  }
  onNewBlock(callback: (block: BlockTransactionObject) => void) {
    if (this.isClosed()) {
      throw new Error("Web3Wrapper is closed");
    }
    this.addListener("newBlock", callback);
    if (!this.newBlockSubscriber) {
      this.subscribeToNewBlockHeader();
    }
    return () => {
      this.removeListener("newBlock", callback);
    };
  }
}
const web3Cache = new Map<string, Web3Wrapper>();
export function getWeb3(chain = "eth") {
  const url = CHAIN_MAPPING[chain]?.includes("://")
    ? CHAIN_MAPPING[chain]
    : `wss://rpc.ankr.com/${CHAIN_MAPPING[chain] || chain}/ws/${process.env.ANKR_KEY}`;
  let wrapper = web3Cache.get(url);
  if (!wrapper || wrapper.isClosed()) {
    wrapper = new Web3Wrapper(url);
    web3Cache.set(url, wrapper);
  } else {
    wrapper.addRef();
  }
  return {
    web3: wrapper.web3,
    close: () => {
      wrapper?.close();
      wrapper = undefined;
    },
    onNewBlock: wrapper?.onNewBlock.bind(wrapper),
  };
}
export function isSameAddress(a, b) {
  if (!a || !b) {
    return false;
  }
  if (/^0x/.test(a) && /^0x/.test(b)) {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}
export function parseEventDeclaration(eventDeclaration: string): AbiItem {
  const m = /^\s*(event +)?([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*;?\s*$/.exec(eventDeclaration);
  if (!m) {
    throw new Error("Invalid event declaration");
  }
  const name = m[2];
  const inputs = m[3].split(",").map((p) => {
    const parts = p.trim().split(/\s+/);
    if (parts.length !== 2 && parts.length !== 3) {
      throw new Error("Invalid event declaration: Invalid parameter " + p);
    }
    if (parts.length === 3 && parts[1] !== "indexed") {
      throw new Error("Invalid event declaration: Invalid parameter " + p);
    }
    return {
      indexed: parts.length === 3,
      type: parts[0],
      name: parts[parts.length - 1],
    };
  });
  return {
    name,
    inputs,
    type: "event",
    anonymous: false,
  };
}
export function parseFunctionDeclaration(functionDeclaration: string): AbiItem {
  const m = /^\s*(function +)?([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*(.*)$/.exec(functionDeclaration);
  if (!m) {
    throw new Error("Invalid function declaration");
  }
  const name = m[2];
  const inputs = m[3].split(",").map((p) => {
    const parts = p.trim().split(/\s+/);
    if (parts.length < 2) {
      throw new Error("Invalid function declaration: Invalid parameter " + p);
    }
    return {
      type: parts[0],
      name: parts[parts.length - 1],
    };
  });
  const suffixes = m[4].trim().split(/\s+/);
  return {
    name,
    inputs,
    constant: suffixes.includes("view"),
    payable: suffixes.includes("payable"),
    stateMutability: suffixes.includes("pure")
      ? "pure"
      : suffixes.includes("view")
      ? "view"
      : suffixes.includes("payable")
      ? "payable"
      : "nonpayable",
    type: "function",
  };
}
