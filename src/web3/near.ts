import { EventEmitter } from "node:events";
import _ from "lodash";
import { base58_to_binary } from "base58-js";
import {
  ConnectorInput,
  ConnectorOutput,
  TriggerBase,
} from "grindery-nexus-common-utils/dist/connector";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import { backOff } from "exponential-backoff";
import { connect, KeyPair, keyStores, utils } from "near-api-js";
import path from "path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const homedir = require("os").homedir();

const CREDENTIALS_DIR = ".near-credentials";
const credentialsPath = path.join(homedir, CREDENTIALS_DIR);
const keyStore = new keyStores.UnencryptedFileSystemKeyStore(credentialsPath);

type Config = {
  keyStore: keyStores.UnencryptedFileSystemKeyStore;
  networkId: string;
  nodeUrl: string;
  explorerUrl: string;
};
const config: Config = {
  keyStore,
  networkId: "testnet",
  nodeUrl: "https://rpc.testnet.near.org",
  explorerUrl: "https://explorer.testnet.near.org",
};

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
          const receipts = [] as Receipt[];
          for (const chunk of block.chunks) {
            await backOff(
              async () => {
                const chunkDetails = await near.connection.provider.chunk(
                  chunk.chunk_hash
                );
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
        // console.log(receipt);
        if (
          this.fields.from &&
          this.fields.from !==
            normalizeAddress(receipt.receipt.Action?.signer_id) &&
          this.fields.from !==
            normalizeAddress(receipt.receipt.Action?.signer_public_key)
        ) {
          return;
        }
        if (
          this.fields.to &&
          this.fields.to !== normalizeAddress(receipt.receiver_id)
        ) {
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
    if (this.fields.contractAddress === "0x0") {
      this.fields.contractAddress = undefined;
    }
    const functions =
      typeof this.fields.eventDeclaration === "string"
        ? [this.fields.eventDeclaration]
        : this.fields.eventDeclaration;
    const unsubscribe = SUBSCRIBER.subscribe({
      callback: async (receipt: Receipt) => {
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

async function createAccount(
  creatorAccountId: string,
  newAccountId: string,
  amount: string
) {
  const near = await connect({
    ...config,
    keyStore,
    headers: {},
  });
  const creatorAccount = await near.account(creatorAccountId);
  const keyPair = KeyPair.fromRandom("ed25519");
  const publicKey = keyPair.getPublicKey.toString();
  await keyStore.setKey(config.networkId, newAccountId, keyPair);

  const result = await creatorAccount.functionCall({
    contractId: "testnet",
    methodName: "create_account",
    args: {
      new_account_id: newAccountId,
      new_public_key: publicKey,
    },
    gas: "300000000000000" as any,
    attachedDeposit: utils.format.parseNearAmount(amount) as any,
  });
}

interface IAcc {
  totalGasBurned: number;
  totalTokensBurned: string;
}

interface ITransactionData {
  signer_id: string;
  public_key: string;
  nonce: number;
  receiver_id: string;
  actions: string[];
  signature: string;
  hash: string;
}

interface IOutcome {
  logs: [];
  receipt_ids: string[];
  gas_burnt: number;
  tokens_burnt: string;
  executor_id: string;
  status: string[];
}

interface ITransactionOutcome {
  proof: [];
  block_hash: string;
  id: string;
  outcome: IOutcome;
}
interface ITransaction {
  status: string;
  transaction: ITransactionData;
  transaction_outcome: ITransactionOutcome;
  receipts_outcome: ITransactionOutcome[];
}

export async function callSmartContract(
  input: ConnectorInput<{
    senderAccount: string;
    receiverAccount: string;
    amount: string;
  }>
): Promise<any> {
  try {
    const near = await connect({
      ...config,
      keyStore,
      headers: {},
    });
    // Create account
    createAccount(
      "olashina.testnet",
      "receiver.testnet",
      "10000000000000000000"
    );

    // Initiate senderAccount
    const sender = await near.account(input.fields.senderAccount);

    // send those tokens! :)
    const result: ITransaction | any = await sender.sendMoney(
      input.fields.receiverAccount,
      "90000000000000000000" as any
    );

    // calculate the amount of gas_burnt
    const { totalGasBurned, totalTokensBurned } =
      result.receipts_outcome.reduce(
        (acc: IAcc, receipt) => {
          acc.totalGasBurned += receipt.outcome.gas_burnt;
          acc.totalTokensBurned += utils.format.formatNearAmount(
            receipt.outcome?.tokens_burnt as any
          );
          return acc;
        },
        {
          totalGasBurned: result.transaction_outcome.outcome.gas_burnt,
          totalTokensBurned: utils.format.formatNearAmount(
            result.transaction_outcome.outcome?.tokens_burnt
          ),
        }
      );

    return {
      success: true,
      transaction: result.transaction,
      explorerUrl: `${config.explorerUrl}/transactions/${result.transaction.hash}`,
      totalGasBurned,
      totalTokensBurned,
    };
  } catch (error) {
    throw new Error(error.cause);
  }
}
