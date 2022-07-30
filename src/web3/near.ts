import { EventEmitter } from "node:events";
import WebSocket from "ws";
import _ from "lodash";
import { connect, Near } from "near-api-js";
import { base58_to_binary } from "base58-js";
import { ConnectorInput, ConnectorOutput, TriggerBase } from "../connectorCommon";
import { InvalidParamsError } from "../jsonrpc";
import { BlockResult } from "near-api-js/lib/providers/provider";

type Receipt = {
  predecessor_id: string;
  receipt: {
    Action?: {
      actions: (
        | { Transfer: { deposit: string } }
        | {
            FunctionCall: {
              args: string;
              deposit: string;
              gas: number;
              method_name: string;
            };
          }
      )[];
      gas_price: string;
      input_data_ids: unknown[];
      output_data_receivers: unknown[];
      signer_id: string;
      signer_public_key: string;
    };
  };
  receipt_id: string;
  receiver_id: string;
};

class ReceiptSubscriber extends EventEmitter {
  private running = false;
  constructor() {
    super();
    this.setMaxListeners(1000);
  }
  async handleBlock(near: Near, block: BlockResult) {
    for (const chunk of block.chunks) {
      const chunkDetails = await near.connection.provider.chunk(chunk.chunk_hash);
      // console.log(chunkDetails);
      for (const receipt of chunkDetails.receipts as Receipt[]) {
        for (const listener of this.listeners("process")) {
          await listener(receipt);
        }
      }
    }
  }
  async main() {
    if (this.running) {
      return;
    }
    const config = {
      networkId: "mainnet",
      nodeUrl: "https://rpc.mainnet.near.org",
      walletUrl: "https://wallet.mainnet.near.org",
      helperUrl: "https://helper.mainnet.near.org",
      explorerUrl: "https://explorer.mainnet.near.org",
      headers: {},
    };
    const near = await connect(config);
    let currentHash = "";
    let currentHeight = 0;
    this.running = true;
    while (this.listenerCount("process") > 0) {
      try {
        const response = await near.connection.provider.block({
          finality: "final",
        });
        if (currentHash === response.header.hash) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
        if (currentHeight && response.header.height < currentHeight) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
        const pendingBlocks = [response];
        while (currentHash && pendingBlocks[0].header.prev_hash !== currentHash) {
          pendingBlocks.unshift(await near.connection.provider.block({ blockId: pendingBlocks[0].header.prev_hash }));
          if (currentHeight && pendingBlocks[0].header.height <= currentHeight) {
            console.log("Last block was removed:", currentHeight, currentHash);
            if (pendingBlocks[0].header.height < currentHeight) {
              pendingBlocks.shift();
            }
            break;
          }
        }
        if (pendingBlocks.length > 10) {
          console.warn(`Too many blocks in a row: ${pendingBlocks.length}`);
        }
        currentHash = response.header.hash;
        currentHeight = response.header.height;
        for (const block of pendingBlocks) {
          await this.handleBlock(near, block);
        }
      } catch (e) {
        console.error("Error in Near event loop:", e);
        this.emit("error", e);
        this.running = false;
        return;
      }
    }
    this.running = false;
  }
  subscribe({ callback, onError }: { callback: (receipt: Receipt) => void; onError: (error: unknown) => void }) {
    const handler = async (receipt: Receipt) => {
      await callback(receipt);
    };
    const errorHandler = (error: unknown) => {
      onError(error);
    };
    this.on("process", handler);
    if (!this.running) {
      this.main().catch((e) => {
        console.error("Error in Near event main loop:", e);
        onError(e);
      });
    }
    return () => {
      this.off("process", handler);
      this.off("error", errorHandler);
    };
  }
}

const SUBSCRIBER = new ReceiptSubscriber();

function normalizeAddress<T>(address: T): T {
  if (!address) {
    return address;
  }
  if (typeof address !== "string") {
    return address;
  }
  if (/^0x[0-9a-f]+$/i.test(address)) {
    return address.slice(2) as unknown as T;
  }
  const m = /^ed25519:([0-9a-z]+)$/i.exec(address);
  if (!m) {
    return address;
  }
  return base58_to_binary(m[1]).toString("hex");
}

class NewTransactionTrigger extends TriggerBase<{ chain: string | string[]; from?: string; to?: string }> {
  async main() {
    if (!this.fields.from && !this.fields.to) {
      throw new InvalidParamsError("from or to is required");
    }
    this.fields.from = normalizeAddress(this.fields.from);
    this.fields.to = normalizeAddress(this.fields.to);
    console.log(`[${this.sessionId}] NewTransactionTrigger:`, this.fields.chain, this.fields.from, this.fields.to);
    const unsubscribe = SUBSCRIBER.subscribe({
      callback: async (receipt: Receipt) => {
        // console.log(receipt);
        if (
          this.fields.from &&
          this.fields.from !== normalizeAddress(receipt.receipt.Action?.signer_id) &&
          this.fields.from !== normalizeAddress(receipt.receipt.Action?.signer_public_key)
        ) {
          return;
        }
        if (this.fields.to && this.fields.to !== normalizeAddress(receipt.receiver_id)) {
          return;
        }
        for (const action of receipt.receipt.Action?.actions ?? []) {
          if (!("Transfer" in action)) {
            continue;
          }
          const transfer = action.Transfer;
          this.sendNotification({
            _grinderyChain: this.fields.chain,
            from: receipt.receipt.Action?.signer_id,
            to: receipt.receiver_id,
            value: transfer.deposit,
            ...receipt,
          });
        }
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
    const functions =
      typeof this.fields.eventDeclaration === "string" ? [this.fields.eventDeclaration] : this.fields.eventDeclaration;
    const unsubscribe = SUBSCRIBER.subscribe({
      callback: async (receipt: Receipt) => {
        if (this.fields.contractAddress && this.fields.contractAddress !== receipt.receiver_id) {
          return;
        }
        for (const action of receipt.receipt.Action?.actions ?? []) {
          if (typeof action !== "object" || !("FunctionCall" in action)) {
            continue;
          }
          const functionCall = action.FunctionCall;
          if (!functions.includes(functionCall.method_name)) {
            continue;
          }
          let args;
          if (functionCall.args.length < 4096) {
            try {
              args = JSON.parse(Buffer.from(functionCall.args, "base64").toString("utf-8"));
            } catch (e) {
              // Fall through
            }
            if (!args) {
              try {
                args = {
                  _argsDecoded: Buffer.from(functionCall.args, "base64").toString("utf-8"),
                };
              } catch (e) {
                // Fall through
              }
            }
          }
          if (!args) {
            args = {
              _rawArgs: functionCall.args,
            };
          }
          args._from = receipt.receipt.Action?.signer_id || normalizeAddress(receipt.receipt.Action?.signer_public_key);
          for (const [key, value] of Object.entries(this.fields.parameterFilters)) {
            if (key.startsWith("_grindery")) {
              continue;
            }
            if (normalizeAddress(_.get(args, key)) !== normalizeAddress(value)) {
              return;
            }
          }
          if (args._rawArgs) {
            delete args._rawArgs;
          }
          this.sendNotification({
            _grinderyChain: this.fields.chain,
            _grinderyContractAddress: receipt.receiver_id,
            ...args,
          });
        }
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

export const Triggers = new Map<string, (socket: WebSocket, params: ConnectorInput) => TriggerBase>();
Triggers.set("newTransaction", (socket, params) => new NewTransactionTrigger(socket, params));
Triggers.set("newEvent", (socket, params) => new NewEventTrigger(socket, params));

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
