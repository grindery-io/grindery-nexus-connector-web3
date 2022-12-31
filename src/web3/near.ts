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
  block_height: number;
  block_hash: string;
};
type SubReceipts = {
  receiptId: string;
  blockHash: string;
  blockHeight: number;
  found: boolean;
};
// type NestedArray<T> = Array<T> | Array<NestedArray<T>>;
type NestedArray<T> = Array<T | NestedArray<T>>;
type TxHashReceipt = {
  txhash: string;
  blockHash: string;
  blockHeight: number;
  receipts: NestedArray<SubReceipts>;
};

/**
 * It takes an array and an array of indexes, and returns the element at the specified indexes
 * @param {any[]} array - The array to search through.
 * @param {number[]} indexes - An array of indexes that will be used to get the element from the array.
 * @returns The element at the given indexes in the array.
 */
const getElement = (array: any[], indexes: number[]) => {
  return indexes.reduce((prev, curr) => {
    return prev[curr];
  }, array);
};
/**
 * It takes an array of arrays and a value, and returns the index of the value in the array of arrays
 * @param array - NestedArray<SubReceipts>
 * @param {string} value - the value you're looking for
 * @returns An array of indexes that lead to the value in the nested array.
 */
const findIndex = (array: any, value: string) => {
  if (!Array.isArray(array)) {return;}
  let i = array.findIndex(e => e.receiptId === value), temp;
  if (i !== -1) {return [i];}
  i = array.findIndex(v => temp = findIndex(v, value));
  if (i !== -1) {return [i, ...temp];}
};

// const findIndex = (array: NestedArray<SubReceipts>, value: string) => {
//   const isSubReceipts = (typeToTest: any) : typeToTest is SubReceipts => {
//     return typeToTest.receiptId !== undefined;
//   };
//   if (!Array.isArray(array)) {return;}
//   let temp;
//   const i = array.findIndex(e => {
//     if (isSubReceipts(e)) {
//       return e.receiptId === value;
//     }
//     temp = findIndex(e, value);
//     if (temp[temp.length - 1] !== -1) {
//       return temp;
//     }
//   });
//   return temp ? (temp[temp.length-1] !== -1 ? [i, ...temp] : []) : [i];
// };

/**
 * It takes an array of arrays and a value, and returns the index of the value in the array of arrays
 * @param {TxHashReceipt[]} arr - TxHashReceipt[] - an array of objects that contain the receiptIds and
 * the receipts.
 * @param {string} receipt - string - the receiptId you're looking for
 * @returns An array of indexes.
 */
async function getIndexReceipt1(arr: TxHashReceipt[], receipt: string): Promise<number[]> {
  let result: number[] = [];
  /* Finding the index of an object in an array of objects. */
  arr.every((t, i) => {
    const tmp = findIndex(t.receipts, receipt);
    if (tmp) {
      result = tmp;
      result.unshift(i);
      return false;
    }
    return true;
  });
  return result;
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
    let txReceipt = [] as TxHashReceipt[];
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
        if (pendingBlocks.length > 10) {
          console.warn(
            `[Near] Too many blocks in a row: ${pendingBlocks.length}`
          );
        }
        pendingBlocks.sort((a, b) => a.header.height - b.header.height);
        for (const [ib, block] of pendingBlocks.entries()) {
          const isLastBlock = ib === pendingBlocks.length-1;
          const nextblockinfos = isLastBlock ? responsePost : pendingBlocks[ib+1];
          const receipts = [] as Receipt[];
          txReceipt = txReceipt.filter(({blockHeight}) => (block.header.height - blockHeight) < 20);
          for (const chunk of block.chunks) {
            await backOff(
              async () => {
                /* Getting the chunk details from the NEAR blockchain. */
                const chunkDetails = await near.connection.provider.chunk(
                  chunk.chunk_hash
                );
                /* Push the transactions and calculate the top receiptsId */
                for (const tx of chunkDetails.transactions) {
                  txReceipt.push({
                    txhash: tx.hash,
                    blockHash: block.header.hash,
                    blockHeight: block.header.height,
                    receipts: [{
                      receiptId: await receiptIdFromTx(tx.hash, block.header.hash, 0),
                      blockHash: "",
                      blockHeight: 0,
                      found: false
                    }],
                  });
                }
                for (const receipt of chunkDetails.receipts) {
                  /* Getting the index of the receipt in the receipt array. */
                  const index = await getIndexReceipt1(txReceipt, receipt.receipt_id);
                  /* A function that is used to get the receipt of a transaction. */
                  if (index.length) {
                    const it = index[0];
                    const idReceipt = index[index.length-1];

                    const receiptArr = getElement(txReceipt[it].receipts, index.slice(1, index.length-1));
                    const topreceiptArr = getElement(txReceipt[it].receipts, index.slice(1, index.length-2));
                    receiptArr[idReceipt].blockHash = block.header.hash;
                    receiptArr[idReceipt].blockHeight = block.header.height;
                    receiptArr[idReceipt].found = true;
                    /* Pushing the receipt information into the receiptArr array. */
                    receiptArr.push({
                      receiptId: receiptArr[idReceipt].receiptId,
                      blockHash: nextblockinfos.header.hash,
                      blockHeight: nextblockinfos.header.height,
                      found: true
                    });
                    /* Removing all the elements from the array that do not have the property found set
                    to true. */
                    _.remove(receiptArr, function(e: SubReceipts) {return !e.found;});
                    /**
                     * It takes an array, two receipt IDs, and pushes an array of two objects into the
                     * array
                     * @param array - the array that will be returned
                     * @param receiptIdb1 - The first receipt ID to be compared.
                     * @param receiptIdb2 - The receiptId of the second block
                     */
                    const pushReceipt = (array: NestedArray<SubReceipts>, receiptIdb1: string, receiptIdb2: string) => {
                      array.push([{
                        receiptId: receiptIdb1,
                        blockHash: "",
                        blockHeight: 0,
                        found: false
                      }, {
                        receiptId: receiptIdb2,
                        blockHash: "",
                        blockHeight: 0,
                        found: false
                      }]);
                    };
                    /* Pushing the receiptId from the current block and the next block into the
                    receiptArr array. */
                    pushReceipt(
                      receiptArr,
                      await receiptIdFromTx(receiptArr[idReceipt].receiptId, block.header.hash, 0),
                      await receiptIdFromTx(receiptArr[idReceipt].receiptId, nextblockinfos.header.hash, 0)
                    );
                    /* Pushing the receiptIds of the top two receipts in the topreceiptArr array into
                    the topreceiptArr array. */
                    pushReceipt(topreceiptArr,
                      await receiptIdFromTx(
                        topreceiptArr[0].receiptId,
                        topreceiptArr[0].blockHash,
                        topreceiptArr.length-2
                      ),
                      await receiptIdFromTx(
                        topreceiptArr[1].receiptId,
                        topreceiptArr[1].blockHash,
                        topreceiptArr.length-2
                      )
                    );
                    /* Fill the tx fields in the receipt object  */
                    receipt.txhash = txReceipt[it].txhash;
                    receipt.block_hash = txReceipt[it].blockHash;
                    receipt.block_height = txReceipt[it].blockHeight;
                  }
                  receipts.push(receipt);
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
          for (const receipt of receipts as Receipt[]) {
            for (const listener of this.listeners("process")) {
              await listener(receipt);
            }
          }
          currentHash = block.header.hash;
          currentHeight = block.header.height;
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
    callback: (receipt: Receipt) => void;
    onError: (error: unknown) => void;
  }) {
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
      callback: async (receipt: Receipt) => {
        blockingTracer.tag("near.NewTransactionTrigger");
        if (
          this.fields.from &&
          this.fields.from !== normalizeAddress(receipt.predecessor_id)
        ) {
          return;
        }
        if (
          this.fields.to &&
          this.fields.to !== normalizeAddress(receipt.receiver_id)
        ) {
          return;
        }
        /* Listening for new transactions on the chain and sending a notification to the receiver of
        the transfer. */
        for (const action of receipt.receipt.Action?.actions ?? []) {
          if (!("Transfer" in action)) {
            continue;
          }
          /* Printing out the details of the transaction. */
          console.log("from", receipt.predecessor_id);
          console.log("to", receipt.receiver_id);
          console.log("value", action.Transfer.deposit);
          console.log("receiptId", receipt.receipt_id);
          console.log("txHash", receipt.txhash);
          console.log("blockHash", receipt.block_hash);
          console.log("blockHeight", receipt.block_height);
          /* Sending a notification to the receiver of the transfer. */
          this.sendNotification({
            _grinderyChain: this.fields.chain,
            from: receipt.predecessor_id,
            to: receipt.receiver_id,
            value: action.Transfer.deposit,
            receiptId: receipt.receipt_id,
            txHash: receipt.txhash,
            blockHash: receipt.block_hash,
            blockHeight: receipt.block_height,
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