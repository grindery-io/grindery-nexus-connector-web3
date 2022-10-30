import Web3 from "web3";
import { Subscription } from "web3-core-subscriptions";
import { BlockTransactionObject } from "web3-eth";
import { EventEmitter } from "node:events";
import blockingTracer from "../../blockingTracer";

export class NewBlockSubscriber extends EventEmitter {
  private newBlockSubscription: null | Subscription<unknown> = null;
  private latestBlock = -1;
  private nextBlock = -1;
  private checking = false;
  private closed = false;
  private pollTimer: null | ReturnType<typeof setTimeout> = null;
  private resetSubscriptionTimer: null | ReturnType<typeof setTimeout> = null;
  private numPolled = 0;
  private lastNoBlockTimestamp = 0;
  constructor(private web3: Web3, private web3Full: Web3, private tag: string) {
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
    if (this.resetSubscriptionTimer) {
      clearTimeout(this.resetSubscriptionTimer);
      this.resetSubscriptionTimer = null;
    }
  }
  unsubscribe() {
    if (this.newBlockSubscription) {
      this.newBlockSubscription.unsubscribe((err) => {
        if (err) {
          console.error(`[${this.tag}] Failed to unsubscribe from newBlockHeaders`, err);
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
    if (this.resetSubscriptionTimer) {
      clearTimeout(this.resetSubscriptionTimer);
    }
    this.resetSubscriptionTimer = setTimeout(() => {
      this.resetSubscriptionTimer = null;
      if (this.closed) {
        return;
      }
      let connectTimeout = setTimeout(() => {
        connectTimeout = null;
        console.error(`[${this.tag}] Timeout when setting up subscription`);
        this.unsubscribe();
      }, 10000) as ReturnType<typeof setTimeout> | null;
      this.newBlockSubscription = this.web3Full.eth
        .subscribe("newBlockHeaders")
        .on("data", (block) => {
          if (!block.number || block.number <= this.latestBlock) {
            return;
          }
          this.latestBlock = block.number;
          this.checkNewBlocks().catch((e) => console.error(`[${this.tag}] Error in checkNewBlocks`, e));
          this.numPolled = 0;
          this.resetPoller();
        })
        .on("error", (error) => {
          if (connectTimeout) {
            clearTimeout(connectTimeout);
            connectTimeout = null;
          }
          if (this.closed) {
            return;
          }
          console.error(error);
          this.unsubscribe();
        })
        .on("connected", () => {
          if (connectTimeout) {
            console.log(`[${this.tag}] Connected to subscription`);
            clearTimeout(connectTimeout);
            connectTimeout = null;
          }
        });
    }, 1000);
  }
  async poll() {
    blockingTracer.tag("newBlockSubScriber.poll");
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.closed) {
      return;
    }
    try {
      let timeout = setTimeout(() => {
        timeout = null;
        console.error(`[${this.tag}] Timeout in poll, latest block:`, this.latestBlock);
        if (this.closed) {
          return;
        }
        this.emit("error", new Error("Timeout in poll"));
        this.resetPoller();
      }, 30000) as ReturnType<typeof setTimeout> | null;
      this.numPolled++;
      let latestBlock = null as number | null;
      try {
        latestBlock = await this.web3.eth.getBlockNumber();
      } finally {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
      }
      if (latestBlock > this.latestBlock) {
        this.latestBlock = latestBlock;
        console.log(`[${this.tag}] Got new block from polling: ${latestBlock}`);
        this.checkNewBlocks().catch((e) => console.error("Error in checkNewBlocks", e));
        if (this.numPolled > 10) {
          this.emit("reconnectProvider");
          this.resetSubscription();
          this.numPolled = 0;
        }
      }
    } catch (e) {
      console.error(`[${this.tag}] Error in poll`, e);
      if (this.numPolled > 10 && this.latestBlock < 0) {
        console.log(`[${this.tag}] Too many errors in poll, stopping`);
        this.emit("stop", e);
        this.close();
      }
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
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.poll();
    }, 30000);
  }
  async checkNewBlocks() {
    blockingTracer.tag("newBlockSubScriber.checkNewBlocks");
    if (this.nextBlock <= 0) {
      this.nextBlock = this.latestBlock;
      return;
    }
    if (this.checking) {
      return;
    }
    if (Date.now() - this.lastNoBlockTimestamp < 5000) {
      return;
    }
    this.checking = true;
    if (this.latestBlock - this.nextBlock > 500) {
      console.log(
        `[${this.tag}] Too many blocks behind, skipping some blocks: ${this.nextBlock} -> ${this.latestBlock}`
      );
      this.nextBlock = this.latestBlock;
    }
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
            console.error(`[${this.tag}] Error getting block:`, e);
            return undefined;
          });
        if (!blockWithTransactions) {
          console.log(`[${this.tag}] No block`, this.nextBlock);
          this.lastNoBlockTimestamp = Date.now();
          return;
        }
        this.nextBlock++;
        if (!blockWithTransactions.transactions) {
          console.log(`[${this.tag}] No transactions in block`, blockWithTransactions.number, blockWithTransactions);
          return;
        }
        this.emit("newBlock", blockWithTransactions);
      }
    } catch (e) {
      if (this.closed) {
        return;
      }
      console.error(`[${this.tag}] Error in checkNewBlocks`, e);
      this.emit("error", e);
    } finally {
      this.checking = false;
    }
  }
}
