import { EventEmitter } from "node:events";
import _ from "lodash";
import { ConnectorInput, ConnectorOutput, TriggerBase } from "grindery-nexus-common-utils/dist/connector";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import { backOff } from "exponential-backoff";
import blockingTracer from "../blockingTracer";
import { parseUserAccessToken, TAccessToken } from "../jwt";
import { v4 as uuidv4 } from "uuid";
import BN from "bn.js";
import { connect, transactions, keyStores, utils, KeyPair } from "near-api-js";
import { normalizeAddress, receiptIdFromTx } from "./near/utils";
import {
  NewEventInput,
  NewTransactionInput,
  TriggerBaseEventConstructor,
  TriggerBasePayload,
  TriggerBaseState,
  TriggerBaseTxConstructor,
} from "./utils";

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
  idParent: number;
  nbreNested: number;
};
type TxHashReceipt = {
  txhash: string;
  blockHash: string;
  blockHeight: number;
  receipts: SubReceipts[];
};
type resultQuery = {
  block_height: number;
  block_hash: string;
  result: number[];
  logs: string[];
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
        // eslint-disable-next-line no-unmodified-loop-condition
        while (currentHash && pendingBlocks[0].header.prev_hash !== currentHash) {
          pendingBlocks.unshift(
            await near.connection.provider.block({
              blockId: pendingBlocks[0].header.prev_hash,
            })
          );
          if (currentHeight && pendingBlocks[0].header.height <= currentHeight) {
            console.log("[Near] Last block was removed:", currentHeight, currentHash);
            if (pendingBlocks[0].header.height < currentHeight) {
              pendingBlocks.shift();
            }
            break;
          }
        }
        if (pendingBlocks.length > 10) {
          console.warn(`[Near] Too many blocks in a row: ${pendingBlocks.length}`);
        }
        pendingBlocks.sort((a, b) => a.header.height - b.header.height);
        for (const [ib, block] of pendingBlocks.entries()) {
          const isLastBlock = ib === pendingBlocks.length - 1;
          const nextblockinfos = isLastBlock ? responsePost : pendingBlocks[ib + 1];
          const receipts = [] as Receipt[];
          txReceipt = txReceipt.filter(({ blockHeight }) => block.header.height - blockHeight < 20);
          for (const chunk of block.chunks) {
            await backOff(
              async () => {
                /* Getting the chunk details from the NEAR blockchain. */
                const chunkDetails = await near.connection.provider.chunk(chunk.chunk_hash);
                /* Push the transactions and calculate the top receiptsId */
                for (const tx of chunkDetails.transactions) {
                  txReceipt.push({
                    txhash: tx.hash,
                    blockHash: block.header.hash,
                    blockHeight: block.header.height,
                    receipts: [
                      {
                        receiptId: await receiptIdFromTx(tx.hash, block.header.hash, 0),
                        blockHash: "",
                        blockHeight: 0,
                        idParent: 0,
                        nbreNested: 0,
                      },
                    ],
                  });
                }
                for (const receipt of chunkDetails.receipts) {
                  /* Finding the index of the receipt in the txReceipt array. */
                  const it = txReceipt.findIndex(
                    (e) => e.receipts.findIndex((r) => r.receiptId === receipt.receipt_id) !== -1
                  );

                  if (it !== -1) {
                    /* Index receipt and parent */
                    const idReceipt = txReceipt[it].receipts.findIndex((r) => r.receiptId === receipt.receipt_id);
                    const idParent = txReceipt[it].receipts[idReceipt].idParent;
                    /* Update block hash and height for the receipt */
                    txReceipt[it].receipts[idReceipt].blockHash = block.header.hash;
                    txReceipt[it].receipts[idReceipt].blockHeight = block.header.height;
                    /* Push same receipt with next block (in case the receipt is executed in the next block) */
                    txReceipt[it].receipts.push({
                      receiptId: txReceipt[it].receipts[idReceipt].receiptId,
                      blockHash: nextblockinfos.header.hash,
                      blockHeight: nextblockinfos.header.height,
                      idParent: txReceipt[it].receipts[idReceipt].idParent,
                      nbreNested: txReceipt[it].receipts[idReceipt].nbreNested,
                    });
                    /* Creating a new receiptId from the previous receiptId = childs. */
                    txReceipt[it].receipts.push({
                      receiptId: await receiptIdFromTx(
                        txReceipt[it].receipts[idReceipt].receiptId,
                        block.header.hash,
                        0
                      ),
                      blockHash: "",
                      blockHeight: 0,
                      idParent: idReceipt,
                      nbreNested: 0,
                    });
                    txReceipt[it].receipts.push({
                      receiptId: await receiptIdFromTx(
                        txReceipt[it].receipts[idReceipt].receiptId,
                        nextblockinfos.header.hash,
                        0
                      ),
                      blockHash: "",
                      blockHeight: 0,
                      idParent: idReceipt + 1,
                      nbreNested: 0,
                    });
                    /* Increase the number of childs for the receipt */
                    txReceipt[it].receipts[idReceipt].nbreNested++;
                    txReceipt[it].receipts[idReceipt + 1].nbreNested++;
                    /* Creating a new receipt and pushing it to the receipts array = brother. */
                    txReceipt[it].receipts.push({
                      receiptId: await receiptIdFromTx(
                        txReceipt[it].receipts[idParent].receiptId,
                        txReceipt[it].receipts[idParent].blockHash,
                        txReceipt[it].receipts[idParent].nbreNested
                      ),
                      blockHash: "",
                      blockHeight: 0,
                      idParent: idReceipt,
                      nbreNested: 0,
                    });
                    /* Incrementing the number of nested receipts for the parent. */
                    txReceipt[it].receipts[idParent].nbreNested++;
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
          await new Promise((resolve) => setTimeout(resolve, 5000));
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
  subscribe({ callback, onError }: { callback: (receipt: Receipt) => void; onError: (error: unknown) => void }) {
    const handler = async (receipt: Receipt) => {
      callback(receipt);
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
class NewTransactionTrigger extends TriggerBase<NewTransactionInput> {
  async main() {
    if (!this.fields.from && !this.fields.to) {
      throw new InvalidParamsError("from or to is required");
    }
    this.fields.from = normalizeAddress(this.fields.from);
    this.fields.to = normalizeAddress(this.fields.to);
    console.log(`[${this.sessionId}] NewTransactionTrigger:`, this.fields.chain, this.fields.from, this.fields.to);
    const unsubscribe = SUBSCRIBER.subscribe({
      callback: async (receipt: Receipt) => {
        blockingTracer.tag("near.NewTransactionTrigger");
        if (this.fields.from && this.fields.from !== normalizeAddress(receipt.predecessor_id)) {
          return;
        }
        if (this.fields.to && this.fields.to !== normalizeAddress(receipt.receiver_id)) {
          return;
        }
        /* Listening for new transactions on the chain and sending a notification to the receiver of
        the transfer. */
        for (const action of receipt.receipt.Action?.actions ?? []) {
          if (!("Transfer" in action)) {
            continue;
          }
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
class NewEventTrigger extends TriggerBase<NewEventInput> {
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
      typeof this.fields.eventDeclaration === "string" ? [this.fields.eventDeclaration] : this.fields.eventDeclaration;
    const unsubscribe = SUBSCRIBER.subscribe({
      callback: async (receipt: any) => {
        blockingTracer.tag("near.NewEventTrigger");
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

export const Triggers = new Map<string, TriggerBaseTxConstructor | TriggerBaseEventConstructor>([
  ["newTransaction", NewTransactionTrigger],
  ["newTransactionAsset", NewTransactionTrigger],
  ["newEvent", NewEventTrigger],
]);

const networkId = "mainnet";
const CONTRACT_NAME = "nft.grindery.near";
const keyStore = new keyStores.InMemoryKeyStore();
const keyPair = process.env.PRIVATE_KEY
  ? KeyPair.fromString(process.env.PRIVATE_KEY as string)
  : KeyPair.fromRandom("ed25519");

keyStore.setKey(networkId, CONTRACT_NAME, keyPair);

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

  const user = await parseUserAccessToken(input.fields.userToken).catch(() => null);
  if (!user) {
    throw new Error("User token is invalid");
  }
  const near = await connect({ ...config, keyStore, headers: {} });
  const account = await near.account(input.fields.contractAddress);

  /* Calling the ft_metadata function of the NEP-141 contract. */
  if (input.fields.functionDeclaration === "getInformationNEP141Token") {
    const queryToken = (await near.connection.provider.query({
      request_type: "call_function",
      finality: "final",
      account_id: input.fields.contractAddress,
      method_name: "ft_metadata",
      args_base64: "",
    })) as resultQuery;

    const result = JSON.parse(String.fromCharCode(...queryToken.result));

    return {
      key: input.key,
      sessionId: input.sessionId,
      payload: {
        name: result.name,
        symbol: result.symbol,
        icon: result.icon,
        decimals: result.decimals.toString(),
      },
    };
  }

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
  // eslint-disable-next-line dot-notation
  const result = await account["signAndSendTransaction"]({
    receiverId: input.fields.contractAddress,
    actions: [
      transactions.functionCall(
        "nft_mint",
        args,
        new BN(10000000000000),
        new BN(utils.format.parseNearAmount("0.1") as string)
      ),
    ],
  });

  return {
    key: input.key,
    sessionId: input.sessionId,
    payload: {
      transactionHash: result.transaction.hash,
    },
  };
}

export async function getUserDroneAddress(_user: TAccessToken): Promise<string> {
  throw new Error("Not implemented");
}
