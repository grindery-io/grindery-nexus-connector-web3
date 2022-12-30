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
import { normalizeAddress, receiptIdFromTx } from "./near/utils";

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
  txhash: string;
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
type TxBlock = {
  currentHeight: number;
  currentHash: string;
  tx: Tx;
  txReceipt: TxReceipt;
};
// type TxHashReceipt = {
//   txhashparent: string;
//   receiptIdparent: string;
//   receiptID: string;
//   receiptIndex: number;
//   blockHashparent: string;
//   blockHash: string;
//   blockHeight: number;
//   level: number;
// };
// type SubReceiptLayers = {
//   receiptId: string;
//   blockHash: string;
//   blockHeight: number;
// };
type SubReceipts = {
  receiptId: string;
  blockHash: string;
  blockHeight: number;
};
// type ReceiptInfos = {
//   receiptIdparent: string;
//   blockHashparent: string;
//   blockHeightparent: number;
//   subreceipts: SubReceipts[];
// };
type BlockInfos = {
  blockHash: string;
  blockHeight: number;
};
type TxHashReceipt = {
  txhash: string;
  blockHash: string;
  blockHeight: number;
  topReceiptBlock: BlockInfos;
  topReceiptBlockPost: BlockInfos;
  // receipts: SubReceipts[][];
  receipts: string[][];
};
type ReceiptsIndex = {
  txIndex: number;
  layerIndex: number;
  nestedIndex: number;
};

const findIndex = (array, value) => {
  if (!Array.isArray(array)) {return;}
  let i = array.indexOf(value), temp;
  if (i !== -1) {return [i];}
  i = array.findIndex(v => temp = findIndex(v, value));
  if (i !== -1) {return [i, ...temp];}
};

async function getIndexReceipt(arr: any[], receipt: any): Promise<ReceiptsIndex> {
  // const result = [] as ReceiptsIndex[];
  const result: ReceiptsIndex = {
    txIndex: -1,
    layerIndex: -1,
    nestedIndex: -1
  };
  arr.every((t, i) => {
    t.receipts.every((r, j) => {
        // r.forEach((n, k) => {
        //   if (n.receiptId === receipt) {
        //     result.push({
        //       txIndex: i,
        //       layerIndex: j,
        //       nestedIndex: k
        //     });
        //   }
        // });

        result.nestedIndex = r.findIndex(e => e === receipt);

        if (result.nestedIndex !== -1) {
          result.txIndex = i;
          result.layerIndex = j;
          return false;
        }
        return true;
      // return (result.length === 0) ? true : false;
    });
    return (result.nestedIndex === -1) ? true : false;
  });
  return result;
}


// async function updateBlockInfoReceipt(txReceipt, idx, blockinfos): Promise<void> {
//   for (let i=0; i<idx.length; i++) {
//     const j = idx[i].txIndex;
//     const k = idx[i].layerIndex;
//     const l = idx[i].nestedIndex;
//     txReceipt[j].receipts[k][l].blockHash = blockinfos[i].blockHash;
//     txReceipt[j].receipts[k][l].blockHeight = blockinfos[i].blockHeight;
//   }
// }

async function updateBlockInfoReceipt(arr, block): Promise<void> {
  arr.blockHash = block.header.hash;
  arr.blockHeight = block.header.height;
}


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
    let txReceipt = [] as TxHashReceipt[]; //new Array<TxHashReceipt>;
    let testreceipts = [] as Receipt[];
    while (this.listenerCount("process") > 0) {
      try {
        const responsePost = await near.connection.provider.block({
          finality: "final",
        });
        const response = await near.connection.provider.block({
          blockId: responsePost.header.prev_hash,
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
        // pendingBlocks.unshift(await near.connection.provider.block({
        //   blockId: pendingBlocks[0].header.prev_hash,
        // }));
        if (pendingBlocks.length > 10) {
          console.warn(
            `[Near] Too many blocks in a row: ${pendingBlocks.length}`
          );
        }
        pendingBlocks.sort((a, b) => a.header.height - b.header.height);

        // for (const [ib, block] of pendingBlocks.slice(0, -1).entries()) {
        // for (const block of pendingBlocks) {
        for (const [ib, block] of pendingBlocks.entries()) {
          const isLastBlock = ib === pendingBlocks.length-1;
          // const blockinfos = [] as BlockInfos[];
          // blockinfos.push({
          //   blockHash: block.header.hash,
          //   blockHeight: block.header.height
          // });
          // blockinfos.push({
          //   blockHash: isLastBlock ? responsePost.header.hash : pendingBlocks[ib+1].header.hash,
          //   blockHeight: isLastBlock ? responsePost.header.height : pendingBlocks[ib+1].header.height
          // });

          const nextblockinfos = isLastBlock ? responsePost : pendingBlocks[ib+1];
          const receipts = [] as Receipt[];
          const txs = [] as Tx[];
          // txReceipt = txReceipt.filter(({blockHeight}) => (block.header.height - blockHeight) < 1000);
          for (const chunk of block.chunks) {
            await backOff(
              async () => {
                const chunkDetails = await near.connection.provider.chunk(
                  chunk.chunk_hash
                );
                // txs.splice(txs.length, 0, ...chunkDetails.transactions as any[]);
                // receipts.splice(receipts.length, 0, ...chunkDetails.receipts);

                for (const tx of chunkDetails.transactions) {
                  txReceipt.push({
                    txhash: tx.hash,
                    blockHash: block.header.hash,
                    blockHeight: block.header.height,
                    topReceiptBlock: {blockHash: "", blockHeight: 0},
                    topReceiptBlockPost: {blockHash: "", blockHeight: 0},
                    receipts: [[
                      await receiptIdFromTx(tx.hash, block.header.hash, 0),
                    ]],
                  });
                }

                for (const receipt of chunkDetails.receipts) {
                  const idx = await getIndexReceipt(txReceipt, receipt.receipt_id);

                  if (idx.txIndex !== -1) {

                    const r = txReceipt[idx.txIndex].receipts[idx.layerIndex][idx.nestedIndex];
                    const topReceipt = txReceipt[idx.txIndex].receipts[0][0];
                    const isFirstLayer = txReceipt[idx.txIndex].receipts[idx.layerIndex].length <= 2;

                    if (txReceipt[idx.txIndex].receipts.length === 1) {
                      txReceipt[idx.txIndex].topReceiptBlock = {
                        blockHash: block.header.hash,
                        blockHeight: block.header.height
                      };
                      txReceipt[idx.txIndex].topReceiptBlockPost = {
                        blockHash: nextblockinfos.header.hash,
                        blockHeight: nextblockinfos.header.height
                      };
                    } else {
                      const receiptIndex = (txReceipt[idx.txIndex].receipts[idx.layerIndex].length - 2)/2;
                      txReceipt[idx.txIndex].receipts[idx.layerIndex].push(
                        await receiptIdFromTx(r, block.header.hash, receiptIndex),
                        await receiptIdFromTx(r, nextblockinfos.header.hash, receiptIndex)
                      );
                    }

                    if (isFirstLayer) {
                      txReceipt[idx.txIndex].receipts.push([
                        await receiptIdFromTx(topReceipt, txReceipt[idx.txIndex].topReceiptBlock.blockHash, idx.layerIndex),
                        await receiptIdFromTx(topReceipt, txReceipt[idx.txIndex].topReceiptBlockPost.blockHash, idx.layerIndex)
                      ]);
                    }
                    receipt.txhash = txReceipt[idx.txIndex].txhash;
                  }


                  receipts.push(receipt);
                  testreceipts.push(receipt);

                  // if (!receipt.txHash) {
                  //   console.log(receipt);
                  // }

                  // if (idx.txIndex === -1) {
                  //   console.log(receipt);
                  //   console.log(block.header.height);

                  //   const jsonData = JSON.stringify(txReceipt, null, 4);
                  //   const jsonreceipts = JSON.stringify(testreceipts, null, 4);

                  //   var fs = require('fs');
                  //   fs.writeFile("test.txt", jsonData, function(err) {
                  //     if (err) {
                  //       console.log(err);
                  //     }
                  //   });

                  //   fs.writeFile("jsonreceipts.txt", jsonreceipts, function(err) {
                  //     if (err) {
                  //       console.log(err);
                  //     }
                  //   });
                  // }

                  // const jsonresult = JSON.stringify(receipt, null, 4);

                  // var fs = require('fs');
                  //   fs.writeFile("jsonresult.txt", jsonresult, function(err) {
                  //     if (err) {
                  //       console.log(err);
                  //     }
                  //   });

                  // console.log(receipt);


                }
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
        // const notSameFrom = this.fields.from && this.fields.from !== normalizeAddress(tx.tx.signer_id)
        // && this.fields.from !== normalizeAddress(tx.tx.public_key);
        // const notSameTo = this.fields.to && this.fields.to !== normalizeAddress(tx.tx.receiver_id);
        // const failure = tx.txReceipt.status.Failure;
        // if (notSameFrom || notSameTo || failure) {
        //   return;
        // }
        // for (const action of tx.tx.actions ?? []) {
        //   if (!("Transfer" in action)) {
        //     continue;
        //   }
        //   const transfer = action.Transfer;

        //   console.log("transfer", transfer);
        //   console.log("tx hash", tx.tx.hash);
        //   console.log("block heigh", tx.currentHeight);
        //   console.log("block hash", tx.currentHash);
        //   console.log("deposit", utils.format.formatNearAmount(transfer.deposit));

        //   this.sendNotification({
        //     from: tx.tx.signer_id,
        //     to: tx.tx.receiver_id,
        //     amount: utils.format.formatNearAmount(transfer.deposit),
        //     txHash: tx.tx.hash,
        //     blockHash: tx.currentHash,
        //     blockHeight: tx.currentHeight,
        //   });
        // }



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
Triggers.set("newTransactionAsset", NewTransactionTrigger);
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



import crypto from "crypto";
import { createHash } from "crypto";
import { serialize, deserialize } from "borsh";
import { base_encode } from "./near/serialize";
import { base58_to_binary, binary_to_base58 } from "base58-js";
import { checkProperties } from "ethers/lib/utils";

async function hash(string: string): Promise<string> {
  const utf8 = new TextEncoder().encode(string);
  const hashBuffer = await crypto.subtle.digest("SHA-256", utf8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((bytes) => bytes.toString(16).padStart(2, "0"))
    .join("");
  return hashHex;
}


async function main() {

  const config = {
    networkId: "mainnet",
    nodeUrl: "https://rpc.mainnet.near.org",
    walletUrl: "https://wallet.mainnet.near.org",
    helperUrl: "https://helper.mainnet.near.org",
    explorerUrl: "https://explorer.mainnet.near.org",
    headers: {},
  };
  const near = await connect(config);

  // const response = await near.connection.provider.block({blockId: 81663610});

  const response = await near.connection.provider.block({
    finality: "final",
  });
  const pendingBlocks = [response];
  const finalBlockHash = response.header.hash;
  const finalBlockHeight = response.header.height;


  pendingBlocks.unshift(await near.connection.provider.block({
    blockId: response.header.height-1,
  }));

  const prevBlockHash = pendingBlocks[0].header.hash;
  const prevBlockHeight = pendingBlocks[0].header.height;

  // console.log({pendingBlocks});

  pendingBlocks.sort((a, b) => a.header.height - b.header.height);
  let txReceipt = [] as TxHashReceipt[]; //new Array<TxHashReceipt>;
  const block = pendingBlocks[0];
  const receipts = [] as Receipt[];
  const txs = [] as Tx[];
  for (const chunk of block.chunks) {

    const chunkDetails = await near.connection.provider.chunk(
      chunk.chunk_hash
    );
    // txs.splice(txs.length, 0, ...chunkDetails.transactions as any[]);
    // receipts.splice(receipts.length, 0, ...chunkDetails.receipts);

    // for (const tx of chunkDetails.transactions) {
    //   txReceipt.push({
    //     txhash: tx.hash,
    //     blockHash: block.header.hash,
    //     blockHeight: block.header.height,
    //     receipts: [[{
    //       receiptId: await receiptIdFromTx(tx.hash, block.header.hash, 0),
    //       blockHash: block.header.hash,
    //       blockHeight: block.header.height,
    //     }]],
    //   });
    // }

    // console.log("txReceipt", txReceipt);



    // for (const receipt of chunkDetails.receipts) {

    //   const idx = await getIndexReceipt(txReceipt, receipt.receipt_id);

    //   if (idx.txIndex !== -1) {

    //     const firstReiceptLayer = txReceipt[idx.txIndex].receipts[idx.layerIndex].length < 3;
    //     const rIndex = txReceipt[idx.txIndex].receipts.length - 1;

    //     // const rId = txReceipt[idx.txIndex].receipts[idx.layerIndex][idx.nestedIndex].receiptId;
    //     // const bHash = txReceipt[idx.txIndex].receipts[idx.layerIndex][idx.nestedIndex].blockHash;
    //     // const bHeight = txReceipt[idx.txIndex].receipts[idx.layerIndex][idx.nestedIndex].blockHeight;

    //     const rBase = txReceipt[idx.txIndex].receipts[0][0];

    //     if (firstReiceptLayer) {
    //       for (const b of pendingBlocks) {
    //         txReceipt[idx.txIndex].receipts.push([{
    //           receiptId: await receiptIdFromTx(rBase.receiptId, rBase.blockHash, idx.layerIndex),
    //           blockHash: b.header.hash,
    //           blockHeight: b.header.height
    //         }]);

    //         if (idx.layerIndex !== 0) {
    //           txReceipt[idx.txIndex].receipts[idx.layerIndex].push({
    //             receiptId: await receiptIdFromTx(rBase.receiptId, rBase.blockHash, idx.layerIndex-1),
    //             blockHash: b.header.hash,
    //             blockHeight: b.header.height
    //           });
    //         }
    //       }
    //     }
    //   }
    // }

  }

  const test = [3, [3, [3, [3, [3, 10, 5], 5], 5], 5], 5];

  async function getIndexOfK(arr, k) {
    for (let i = 0; i < arr.length; i++) {
      const index = arr[i].indexOf(k);
      if (index > -1) {
        return [i, index];
      }
    }
  }

  let getIndex = (a, n) => {
    let x = -1;
    return [a.findIndex(e => (x = e[1]?.indexOf(n), x !== -1)), x];
  };

  const findIndex = (array, value) => {
    if (!Array.isArray(array)) {return;}
    let i = array.indexOf(value), temp;
    if (i !== -1) {return [i];}
    i = array.findIndex(v => temp = findIndex(v, value));
    if (i !== -1) {return [i, ...temp];}
  };

  console.log( findIndex(test, 100));

}

// main();