import { EventEmitter } from "node:events";
import _ from "lodash";
import { ConnectorInput, ConnectorOutput, TriggerBase } from "grindery-nexus-common-utils/dist/connector";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import { backOff } from "exponential-backoff";
import blockingTracer from "../../blockingTracer";
import { hmac, TAccessToken, parseUserAccessToken } from "../../jwt";
import { base58_to_binary } from "base58-js";
import { base_encode } from "./serialize";
import { nearGetAccount } from "./utils";
import { SendTransactionAction } from "../actions";
import {
  getNetworkId,
  DepayActions,
  NearDepayActions,
  NewTransactionInput,
  TriggerBasePayload,
  TriggerBaseState,
  NewEventInput,
  TriggerBaseTxConstructor,
  TriggerBaseEventConstructor,
} from "../utils";
import nacl from "tweetnacl";
import BN from "bn.js";

import { connect, KeyPair, keyStores, utils } from "near-api-js";

// const CREDENTIALS_DIR = ".near-credentials";
// const credentialsPath = path.join(homedir, CREDENTIALS_DIR);
// const keyStore = new keyStores.UnencryptedFileSystemKeyStore(credentialsPath);

// // type Config = {
// //   keyStore: keyStores.UnencryptedFileSystemKeyStore;
// //   networkId: string;
// //   nodeUrl: string;
// //   explorerUrl: string;
// // };

// const config = {
//   keyStore,
//   networkId: "testnet",
//   nodeUrl: "https://rpc.testnet.near.org",
//   explorerUrl: "https://explorer.testnet.near.org",
// };

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
        for (const block of pendingBlocks) {
          const receipts = [] as Receipt[];
          for (const chunk of block.chunks) {
            await backOff(
              async () => {
                const chunkDetails = await near.connection.provider.chunk(chunk.chunk_hash);
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
          await new Promise((resolve) => setTimeout(resolve, 5000));
          lastErrorHeight = currentHeight;
          continue;
        }
      }
    }
    this.running = false;
    console.log("[Near] event main loop stopped");
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

class NewTransactionTrigger extends TriggerBase<NewTransactionInput, TriggerBasePayload, TriggerBaseState> {
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

class NewEventTrigger extends TriggerBase<NewEventInput, TriggerBasePayload, TriggerBaseState> {
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
      callback: async (receipt: Receipt) => {
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
    _grinderyUserToken: string;
  }>
): Promise<ConnectorOutput> {
  // Verify the userToken is valid
  const user = await parseUserAccessToken(input.fields._grinderyUserToken || input.fields.userToken).catch(() => null);
  if (!user) {
    throw new Error("User token is invalid");
  }

  const CONTRACT_NAME = "tcoratger.testnet";

  // Set the key store in memory
  const networkId = await getNetworkId(input.fields.chain);
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(networkId, CONTRACT_NAME, KeyPair.fromString(process.env.PRIVATE_KEY as string));

  // Get grindery account
  const grinderyAccount = await nearGetAccount(input.fields.chain, process.env.NEAR_ACCOUNT_ID || "", keyStore);

  // Get user key pair
  const seed = (await hmac("grindery-near-key/" + user.sub)).subarray(0, 32);
  const newkeypairtmp = nacl.sign.keyPair.fromSeed(seed);
  const newKeyPair = new utils.KeyPairEd25519(base_encode(newkeypairtmp.secretKey));
  const newPublicKey = newKeyPair.getPublicKey();

  // Get user implicit account from the new key pair
  const implicit_user_id = Buffer.from(utils.PublicKey.fromString(newPublicKey.toString()).data).toString("hex");
  await keyStore.setKey(networkId, implicit_user_id, newKeyPair);
  const useraccount = await nearGetAccount(input.fields.chain, implicit_user_id, keyStore);

  // Test the state of the user account to know if it exists
  try {
    await useraccount.state();
  } catch (e) {
    // If ueser account doens't exist, then create an implicit grinderyAccount via transaction
    if (e.type === "AccountDoesNotExist") {
      await grinderyAccount.sendMoney(implicit_user_id, new BN(utils.format.parseNearAmount("1") as string));
    }
  }

  // Set depay actions parameters
  const depayparameter: DepayActions<NearDepayActions> = {
    fields: {
      grinderyAccount,
      userAccount: await nearGetAccount(input.fields.chain, implicit_user_id, keyStore),
    },
  };

  // Send the transaction to be routed via the function declaration
  return await SendTransactionAction(input, depayparameter);
}

export async function getUserDroneAddress(_user: TAccessToken): Promise<string> {
  throw new Error("Not implemented");
}
