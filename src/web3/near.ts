import { EventEmitter } from "node:events";
import _ from "lodash";
import {
  ConnectorInput,
  ConnectorOutput,
  TriggerBase,
} from "grindery-nexus-common-utils/dist/connector";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import { backOff } from "exponential-backoff";
import blockingTracer from "../blockingTracer";
import { parseUserAccessToken, TAccessToken } from "../jwt";
import { v4 as uuidv4 } from "uuid";
import { KeyPair } from "near-api-js";
import BN from "bn.js";
// import { connect, transactions, keyStores } from "near-api-js";
// import * as nearAPI from "near-api-js";
// import fs from "fs";
// import path from "path";
// import { homedir } from 'os';

import { connect, transactions, keyStores, utils } from "near-api-js";
import { normalizeAddress } from "./near/utils";

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


type Tx = {
  actions: Array<any>;
  hash: string;
  nonce: BN;
  public_key: string;
  receiver_id: string;
  signature: string;
  signer_id: string;
};

type TxBlock = {
  currentHeight: number;
  currentHash: string;
  // status: {
  //   SuccessValue?: string;
  //   Failure?: {
  //     error_message: string;
  //     error_type: string;
  //   };
  // };
  tx: Tx;
  txReceipt: TxReceipt;
};

type Txstatus = {
  SuccessValue?: string;
  Failure?: {
    error_message: string;
    error_type: string;
  };
};

type ExecutionOutcomeWithId = {
  id: string;
  outcome: {
    logs: string[];
    receipt_ids: string[];
    gas_burnt: number;
    status: Txstatus;
  };
};

type TxReceipt = {
  status: Txstatus;
  transaction: any;
  transaction_outcome: ExecutionOutcomeWithId;
  receipts_outcome: ExecutionOutcomeWithId[];
};

class ReceiptSubscriber extends EventEmitter {
  private running = false;
  constructor() {
    super();
    this.setMaxListeners(1000);
  }
  /**
   * It connects to the NEAR blockchain, and then it loops forever, getting the latest block, getting
   * the receipts from that block, and then calling the "process" event listeners with each receipt
   * @returns a promise.
   */
  async main() {
    blockingTracer.tag("near.ReceiptSubscriber.main");
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
    let lastErrorHeight = 0;
    this.running = true;
    console.log("[Near] event main loop started");
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
        while (
          currentHash &&
          pendingBlocks[0].header.prev_hash !== currentHash
        ) {
          pendingBlocks.unshift(
            await near.connection.provider.block({
              blockId: pendingBlocks[0].header.prev_hash,
            })
          );
          if (
            currentHeight &&
            pendingBlocks[0].header.height <= currentHeight
          ) {
            console.log(
              "[Near] Last block was removed:",
              currentHeight,
              currentHash
            );
            if (pendingBlocks[0].header.height < currentHeight) {
              pendingBlocks.shift();
            }
            break;
          }
        }
        if (pendingBlocks.length > 10) {
          console.warn(
            `[Near] Too many blocks in a row: ${pendingBlocks.length}`
          );
        }
        pendingBlocks.sort((a, b) => a.header.height - b.header.height);
        for (const block of pendingBlocks) {
          // const receipts = [] as Receipt[];
          const receipts = [] as Receipt[];
          const txs = [] as Tx[];
          for (const chunk of block.chunks) {
            await backOff(
              async () => {
                const chunkDetails = await near.connection.provider.chunk(
                  chunk.chunk_hash
                );
                txs.splice(txs.length, 0, ...chunkDetails.transactions as any[]);
                receipts.splice(receipts.length, 0, ...chunkDetails.receipts);
              },
              {
                maxDelay: 10000,
                numOfAttempts: 5,
                retry: (e, attemptNumber) => {
                  console.error(
                    `[Near] Failed to get chunk ${chunk.chunk_hash} for block ${block.header.height} (attempt ${attemptNumber}):`,
                    e
                  );
                  return true;
                },
              }
            );
          }
          // for (const receipt of receipts as any[]) {
          //   for (const listener of this.listeners("process")) {
          //     await listener(receipt);
          //   }
          // }

          currentHash = block.header.hash;
          currentHeight = block.header.height;
          for (const tx of txs as Tx[]) {
            for (const listener of this.listeners("process")) {
              await listener({
                currentHeight: block.header.hash,
                currentHash: block.header.height,
                txReceipt: {},
                // await near.connection.provider.txStatus(tx.hash, tx.signer_id), 
                tx
              });
            }
          }
        }
      } catch (e) {
        console.error("[Near] Error in Near event loop:", e);
        if (lastErrorHeight === currentHeight) {
          console.error("[Near] Possible non-recoverable error, stopping");
          this.emit("error", e);
          this.running = false;
          break;
        } else {
          await new Promise((res) => setTimeout(res, 5000));
          lastErrorHeight = currentHeight;
          continue;
        }
      }
    }
    this.running = false;
    console.log("[Near] event main loop stopped");
  }


  /**
   * It subscribes to the "process" event, and when it receives a receipt, it calls the callback
   * function
   * @param  - `callback` is the function that will be called when a new receipt is received.
   * @returns A function that removes the event listener.
   */
  subscribe({
    callback,
    onError,
  }: {
    callback: (tx: TxBlock) => void;
    onError: (error: unknown) => void;
  }) {
    const handler = async (tx: TxBlock) => {
      await callback(tx);
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

/* It subscribes to the `SUBSCRIBER` and sends a notification to the user when a transaction is
received */
class NewTransactionTrigger extends TriggerBase<{
  chain: string | string[];
  from?: string;
  to?: string;
}> {
  async main() {
    if (!this.fields.from && !this.fields.to) {
      throw new InvalidParamsError("from or to is required");
    }
    this.fields.from = normalizeAddress(this.fields.from);
    this.fields.to = normalizeAddress(this.fields.to);
    console.log(
      `[${this.sessionId}] NewTransactionTrigger:`,
      this.fields.chain,
      this.fields.from,
      this.fields.to
    );
    const unsubscribe = SUBSCRIBER.subscribe({
      callback: async (tx: TxBlock) => {
        blockingTracer.tag("near.NewTransactionTrigger");

        const notSameFrom = this.fields.from && this.fields.from !== normalizeAddress(tx.tx.signer_id) 
        && this.fields.from !== normalizeAddress(tx.tx.public_key);
        const notSameTo = this.fields.to && this.fields.to !== normalizeAddress(tx.tx.receiver_id);
        const failure = tx.txReceipt.status.Failure;

        if (notSameFrom || notSameTo || failure) {
          return;
        }

        for (const action of tx.tx.actions ?? []) {
          if (!("Transfer" in action)) {
            continue;
          }
          const transfer = action.Transfer;

          console.log("transfer", transfer);
          console.log("tx hash", tx.tx.hash);
          console.log("block heigh", tx.currentHeight);
          console.log("block hash", tx.currentHash);
          console.log("deposit", utils.format.formatNearAmount(transfer.deposit));

          this.sendNotification({
            from: tx.tx.signer_id,
            to: tx.tx.receiver_id,
            amount: utils.format.formatNearAmount(transfer.deposit),
            txHash: tx.tx.hash,
            blockHash: tx.currentHash,
            blockHeight: tx.currentHeight,
          });
        }
        // if (
        //   this.fields.from &&
        //   this.fields.from !==
        //     normalizeAddress(receipt.receipt.Action?.signer_id) &&
        //   this.fields.from !==
        //     normalizeAddress(receipt.receipt.Action?.signer_public_key)
        // ) {
        //   return;
        // }
        // if (
        //   this.fields.to &&
        //   this.fields.to !== normalizeAddress(receipt.receiver_id)
        // ) {
        //   return;
        // }
        // for (const action of receipt.receipt.Action?.actions ?? []) {
        //   if (!("Transfer" in action)) {
        //     continue;
        //   }
        //   const transfer = action.Transfer;

        //   console.log("transfert", transfer);
        //   console.log("receipt", receipt);
        //   this.sendNotification({
        //     _grinderyChain: this.fields.chain,
        //     from: receipt.receipt.Action?.signer_id,
        //     to: receipt.receiver_id,
        //     value: transfer.deposit,
        //     ...receipt,
        //   });
        // }
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



/* It subscribes to the blockchain and sends a notification whenever a contract emits an event */
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
      this.fields.contractAddress = undefined;
    }
    const functions =
      typeof this.fields.eventDeclaration === "string"
        ? [this.fields.eventDeclaration]
        : this.fields.eventDeclaration;
    const unsubscribe = SUBSCRIBER.subscribe({
      callback: async (receipt: any) => {
        blockingTracer.tag("near.NewEventTrigger");
        if (
          this.fields.contractAddress &&
          this.fields.contractAddress !== receipt.receiver_id
        ) {
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
              args = JSON.parse(
                Buffer.from(functionCall.args, "base64").toString("utf-8")
              );
            } catch (e) {
              // Fall through
            }
            if (!args) {
              try {
                args = {
                  _argsDecoded: Buffer.from(
                    functionCall.args,
                    "base64"
                  ).toString("utf-8"),
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
          args._from =
            receipt.receipt.Action?.signer_id ||
            normalizeAddress(receipt.receipt.Action?.signer_public_key);
          for (const [key, value] of Object.entries(
            this.fields.parameterFilters
          )) {
            if (key.startsWith("_grindery")) {
              continue;
            }
            if (
              normalizeAddress(_.get(args, key)) !== normalizeAddress(value)
            ) {
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

export const Triggers = new Map<
  string,
  new (params: ConnectorInput) => TriggerBase
>();
Triggers.set("newTransaction", NewTransactionTrigger);
Triggers.set("newEvent", NewEventTrigger);

// #########################################################################
// #########################################################################
// #########################################################################

const networkId = "mainnet";
const CONTRACT_NAME = "nft.grindery.near";
const keyStore = new keyStores.InMemoryKeyStore();
const keyPair = KeyPair.fromString(process.env.PRIVATE_KEY as string);

keyStore.setKey(networkId, CONTRACT_NAME, keyPair);

// #########################################################################
// #########################################################################
// #########################################################################

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
    userToken: string;
  }>
): Promise<ConnectorOutput> {
  const config = {
    keyStore,
    networkId,
    nodeUrl: "https://rpc.mainnet.near.org",
  };

  const user = await parseUserAccessToken(input.fields.userToken).catch(
    () => null
  );
  if (!user) {
    throw new Error("User token is invalid");
  }

  // #################################################################
  // #################################################################
  // #################################################################

  

  // #################################################################
  // #################################################################
  // #################################################################

  const near = await connect({ ...config, keyStore, headers: {} });
  const account = await near.account(input.fields.contractAddress);

  const args = {
    token_id: uuidv4(),
    metadata: {
      title: input.fields.parameters.title,
      description: input.fields.parameters.description,
      media: input.fields.parameters.media,
    },
    receiver_id: input.fields.parameters.to,
  };

  // Need array indexing to fix TS2445
  const result = await account["signAndSendTransaction"]({
    receiverId: input.fields.contractAddress,
    actions: [
      transactions.functionCall(
        "nft_mint",
        args,
        new BN(10000000000000),
        new BN((await utils.format.parseNearAmount("0.1")) as string)
      ),
    ],
  });

  console.log(result);

  return {
    key: input.key,
    sessionId: input.sessionId,
    payload: {
      // result,
      // transactionHash: result.transaction_outcome.outcome.receipt_ids
      // txn_hash: result.transaction.hash,
      transactionHash: result.transaction.hash,
      // public_key: result.transaction.public_key,
      // media_url: input.fields.parameters.media,
      // // signer_id: result.transaction.signer_id,
      // transactionHash: result.transaction.signer_id
    },
  };

  // console.log("callSmartContract", input);
  // throw new Error("Not implemented");
}

export async function getUserDroneAddress(
  _user: TAccessToken
): Promise<string> {
  throw new Error("Not implemented");
}