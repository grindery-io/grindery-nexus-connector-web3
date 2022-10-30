import { EventEmitter } from "node:events";
import _ from "lodash";
import axios from "axios";
import { ConnectorInput, ConnectorOutput, TriggerBase } from "grindery-nexus-common-utils/dist/connector";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import blockingTracer from "../blockingTracer";

type Status = {
  catchpoint: string;
  "catchpoint-acquired-blocks": number;
  "catchpoint-processed-accounts": number;
  "catchpoint-total-accounts": number;
  "catchpoint-total-blocks": number;
  "catchpoint-verified-accounts": number;
  "catchup-time": number;
  "last-catchpoint": string;
  "last-round": number;
  "last-version": string;
  "next-version": string;
  "next-version-round": number;
  "next-version-supported": boolean;
  "stopped-at-unsupported-round": boolean;
  "time-since-last-round": number;
};
type TxnDetails =
  | {
      amt: number;
      fee: number;
      fv: number;
      gen: string;
      gh: string;
      lv: number;
      note: string;
      rcv: string;
      snd: string;
      type: "pay";
    }
  | {
      close: string;
      fee: number;
      fv: number;
      gen: string;
      gh: string;
      lv: number;
      rcv: string;
      snd: string;
      type: "pay";
    }
  | {
      fee: number;
      fv: number;
      gh: string;
      lv: number;
      selkey: string;
      snd: string;
      type: "keyreg";
      votefst: number;
      votekd: number;
      votekey: string;
      votelst: number;
    }
  | {
      fee: number;
      fv: number;
      gh: string;
      lv: number;
      snd: string;
      type: "keyreg";
    }
  | {
      apar?: Partial<{
        am: string;
        an: string;
        au: string;
        c: string;
        dc: number;
        f: string;
        m: string;
        r: string;
        t: number;
        un: string;
      }>;
      fee: number;
      fv: number;
      gh: string;
      lv: number;
      snd: string;
      type: "acfg";
    }
  | {
      aamt: number;
      arcv: string;
      asnd: string;
      fee: number;
      fv: number;
      gh: string;
      lv: number;
      snd: string;
      type: "axfer";
      xaid: number;
    }
  | {
      afrz: boolean;
      fadd: string;
      faid: number;
      fee: number;
      fv: number;
      gh: string;
      lv: number;
      snd: string;
      type: "afrz";
    }
  | {
      apan?: number;
      apap?: string;
      apgs?: {
        nbs: number;
        nui: number;
      };
      apid?: number;
      apls?: {
        nbs: number;
        nui: number;
      };
      apsu?: string;
      fee: number;
      fv: number;
      gh: string;
      lv: number;
      note: string;
      snd: string;
      type: "appl";
    };
interface Txn {
  hgi?: boolean;
  sig?: string;
  txn: TxnDetails;
}
interface Block {
  earn: number;
  fees: string;
  frac: number;
  gen: string;
  gh: string;
  prev: string;
  proto: string;
  rnd: number;
  rwcalr: number;
  rwd: string;
  seed: string;
  tc: number;
  ts: number;
  txn: string;
  txns: Txn[];
}
type BlockResponse = {
  block: Block;
};

async function arApi(path: "status"): Promise<Status>;
async function arApi(path: ["blocks", string]): Promise<BlockResponse>;
async function arApi(path: string | string[]): Promise<unknown> {
  if (Array.isArray(path)) {
    path = path.join("/");
  }
  const response = await axios.get("https://node.algoexplorerapi.io/v2/" + path);
  return response.data;
}

class TransactionSubscriber extends EventEmitter {
  private running = false;
  constructor() {
    super();
    this.setMaxListeners(1000);
  }
  async handleBlock(block: BlockResponse) {
    blockingTracer.tag("algorand.TransactionSubscriber.handleBlock");
    for (const txn of block.block.txns) {
      for (const listener of this.listeners("process")) {
        await listener(txn);
      }
    }
  }
  async main() {
    if (this.running) {
      return;
    }
    const status = await arApi("status");
    let currentHeight = status["last-round"];
    this.running = true;
    while (this.listenerCount("process") > 0) {
      try {
        const response = await arApi(["blocks", currentHeight.toString()]).catch((e) => {
          if (e.isAxiosError && e.response?.status === 404) {
            return null;
          }
          return Promise.reject(e);
        });
        if (!response) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }
        await this.handleBlock(response);
        currentHeight++;
      } catch (e) {
        if (e.isAxiosError && e.response?.status >= 500) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
        console.error("Error in Algorand event loop:", e);
        this.emit("error", e);
        this.running = false;
        return;
      }
    }
    this.running = false;
  }
  subscribe({ callback, onError }: { callback: (tx: Txn) => void; onError: (error: unknown) => void }) {
    const handler = async (tx: Txn) => {
      await callback(tx);
    };
    const errorHandler = (error: unknown) => {
      onError(error);
    };
    this.on("process", handler);
    if (!this.running) {
      this.main().catch((e) => {
        console.error("Error in Algorand event main loop:", e);
        onError(e);
      });
    }
    return () => {
      this.off("process", handler);
      this.off("error", errorHandler);
    };
  }
}

const SUBSCRIBER = new TransactionSubscriber();

class NewTransactionTrigger extends TriggerBase<{ chain: string | string[]; from?: string; to?: string }> {
  async main() {
    if (!this.fields.from && !this.fields.to) {
      throw new InvalidParamsError("from or to is required");
    }
    console.log(`[${this.sessionId}] NewTransactionTrigger:`, this.fields.chain, this.fields.from, this.fields.to);
    const unsubscribe = SUBSCRIBER.subscribe({
      callback: async (tx: Txn) => {
        blockingTracer.tag("algorand.NewTransactionTrigger");
        if (tx.txn.type !== "pay") {
          return;
        }
        if (this.fields.from && this.fields.from !== tx.txn.snd) {
          return;
        }
        if (this.fields.to && this.fields.to !== tx.txn.rcv) {
          return;
        }
        if (!("amt" in tx.txn)) {
          return;
        }
        this.sendNotification({
          _grinderyChain: this.fields.chain,
          from: tx.txn.snd,
          to: tx.txn.rcv,
          value: tx.txn.amt,
          ...tx.txn,
        });
      },
      onError: (error: unknown) => {
        this.interrupt(error);
      },
    });
    try {
      await this.waitForStop();
    } finally {
      unsubscribe();
    }
  }
}
class NewEventTrigger extends TriggerBase<{
  chain: string | string[];
  contractAddress?: string;
  eventDeclaration: string | string[];
  parameterFilters: { [key: string]: unknown };
}> {
  async main() {
    console.log(
      `[${this.sessionId}] NewEventTrigger:`,
      this.fields.chain,
      this.fields.contractAddress,
      this.fields.eventDeclaration,
      this.fields.parameterFilters
    );
    if (this.fields.contractAddress === "0x0") {
      delete this.fields.contractAddress;
    }
    const unsubscribe = SUBSCRIBER.subscribe({
      callback: async (tx: Txn) => {
        blockingTracer.tag("algorand.NewEventTrigger");
        if (tx.txn.type !== this.fields.eventDeclaration) {
          return;
        }
        if (this.fields.contractAddress) {
          if (tx.txn.type === "appl") {
            if (tx.txn.apid?.toString() !== this.fields.contractAddress) {
              return;
            }
          } else if ("xaid" in tx.txn) {
            if (tx.txn.xaid?.toString() !== this.fields.contractAddress) {
              return;
            }
          } else {
            return;
          }
        }
        let args = tx.txn;
        const note = "note" in tx.txn ? tx.txn.note : "";
        if (note && note.length < 4096) {
          try {
            const decoded = JSON.parse(Buffer.from(note, "base64").toString("utf-8"));
            args = { ...args, ...decoded };
          } catch (e) {
            // ignore
          }
        }
        for (const [key, value] of Object.entries(this.fields.parameterFilters)) {
          if (key.startsWith("_grindery")) {
            continue;
          }
          if (_.get(args, key) !== value) {
            return;
          }
        }
        this.sendNotification({
          _grinderyChain: this.fields.chain,
          ...args,
        });
      },
      onError: (error: unknown) => {
        this.interrupt(error);
      },
    });
    try {
      await this.waitForStop();
    } finally {
      unsubscribe();
    }
  }
}

export const Triggers = new Map<string, new (params: ConnectorInput) => TriggerBase>();
Triggers.set("newTransaction", NewTransactionTrigger);
Triggers.set("newEvent", NewEventTrigger);

export async function callSmartContract(
  input: ConnectorInput<{
    chain: string;
    contractAddress: string;
    functionDeclaration: string;
    parameters: { [key: string]: unknown };
    maxFeePerGas?: string | number;
    maxPriorityFeePerGas?: string | number;
    gasLimit?: string | number;
    dryRun?: boolean;
  }>
): Promise<ConnectorOutput> {
  console.log("callSmartContract", input);
  throw new Error("Not implemented");
}
