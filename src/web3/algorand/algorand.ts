import { EventEmitter } from "node:events";
import _ from "lodash";
import axios from "axios";
import { ConnectorInput, ConnectorOutput, TriggerBase } from "grindery-nexus-common-utils/dist/connector";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import { parseUserAccessToken, TAccessToken } from "../../jwt";
import algosdk from "algosdk";
import { getUserAccountAlgorand, getAlgodClient, SignedTransactionWithAD } from "./utils";
import { SendTransactionAction } from "../actions";
import { DepayActions, AlgorandDepayActions } from "../utils";
import BigNumber from "bignumber.js";

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
type Txn = {
  hgi?: boolean;
  sig?: Buffer;
  txn: Record<string, any>;
  blockHash?: string;
  blockRnd?: string;
  blockgh: Buffer;
  blockgen: string;
};
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
type BlockHashResponse = {
  blockHash: string;
};
type AssetParams = {
  index: number;
  params: {
    creator: string;
    decimals: number | bigint;
    total: number | bigint;
    clawback?: string;
    defaultFrozen?: boolean;
    freeze?: string;
    manager?: string;
    metadataHash?: Uint8Array;
    name?: string;
    nameB64?: Uint8Array;
    reserve?: string;
    unitName?: string;
    unitNameB64?: Uint8Array;
    url?: string;
    urlB64?: Uint8Array;
  };
}

/**
 * It takes a string or an array of strings, joins them with slashes, and then makes a GET request to
 * the Algorand API
 * @param {string | string[]} path - "status"
 * @returns The return type is unknown.
 */
async function arApi(path: "status"): Promise<Status>;
async function arApi(path: ["blocks", string]): Promise<BlockResponse>;
async function arApi(path: ["blocks", string, "hash"]): Promise<BlockHashResponse>;
async function arApi(path: ["assets", string]): Promise<AssetParams>;
async function arApi(path: string | string[]): Promise<unknown> {
  if (Array.isArray(path)) {
    path = path.join("/");
  }
  const response = await axios.get("https://node.algoexplorerapi.io/v2/" + path);
  // const response = await axios.get("https://node.testnet.algoexplorerapi.io/v2/" + path);
  return response.data;
}
/* It subscribes to the Algorand blockchain and emits an event for each transaction */
class TransactionSubscriber extends EventEmitter {
  private running = false;
  constructor() {
    super();
    this.setMaxListeners(1000);
  }
  async main() {
    if (this.running) {
      return;
    }
    const status = await arApi("status");
    let currentHeight = status["last-round"];
    this.running = true;
    const algodClient = await getAlgodClient("algorand:mainnet");
    while (this.listenerCount("process") > 0) {
      try {
        /* Processing the transactions in a block. */
        const blockHash = await arApi(["blocks", currentHeight.toString(), "hash"]);
        const block = await algodClient.block(currentHeight).do();
        if (block.block.txns && block.block.txns.length > 0) {
          for (const txn of block.block.txns) {
            for (const listener of this.listeners("process")) {
              await listener({
                txn,
                blockHash: blockHash.blockHash,
                blockRnd: block.block.rnd,
                blockgh: block.block.gh,
                blockgen: block.block.gen
              });
            }
          }
        }
        currentHeight++;
      } catch (e) {
        if (e.isAxiosError && e.response?.status === 404) {
          continue;
        }
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
/* It subscribes to the Algorand network and sends a notification to the user when a new transaction is
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
    console.log(`[${this.sessionId}] NewTransactionTrigger:`, this.fields.chain, this.fields.from, this.fields.to);
    const unsubscribe = SUBSCRIBER.subscribe({
      callback: async (tx: Txn) => {
        /* Checking if the transaction is a payment or an asset transfer. */
        if (tx.txn.txn.type !== "pay") {
          return;
        }
        /* Checking if the transaction is from the correct sender. */
        if (this.fields.from && this.fields.from !== algosdk.encodeAddress(tx.txn.txn.snd)) {
          return;
        }
        /* Checking if the recipient address matches
        the address we are looking for. */
        if (this.fields.to && tx.txn.txn.rcv && this.fields.to !== algosdk.encodeAddress(tx.txn.txn.rcv)) {
          return;
        }
        /* Checking if the transaction is a new transaction and if the transaction has an amount. */
        if (!("amt" in tx.txn.txn)) {
          return;
        }
        /* Creating a new instance of the SignedTransactionWithAD class. */
        const stwad = new SignedTransactionWithAD(
          tx.blockgh,
          tx.blockgen,
          tx.txn
        );
        /* Converting the transaction data into a format that can be used. */
        const tx_from = algosdk.encodeAddress(tx.txn.txn.snd);
        const tx_id = stwad.txn.txn.txID();
        const tx_to = algosdk.encodeAddress(tx.txn.txn.rcv);
        const tx_amount = (new BigNumber(tx.txn.txn.amt).div(
          new BigNumber(10).pow(new BigNumber(6))
        )).toString();
        /* Printing the transaction details to the console. */
        console.log("from", tx_from);
        console.log("to", tx_to);
        console.log("amount", tx_amount);
        console.log("txID", tx_id);
        console.log("blockHash", tx.blockHash);
        console.log("blockRnd", tx.blockRnd?.toString());
        /* Sending a notification to the user. */
        this.sendNotification({
          from: tx_from,
          to: tx_to,
          amount: tx_amount,
          txHash: tx_id,
          blockHash: tx.blockHash,
          blockHeight: tx.blockRnd?.toString()
        });
      },
      /* A callback function that is called when an error occurs. */
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
/* It subscribes to the Algorand node and waits for a new transaction to be sent from the sender
address to the recipient address. If the transaction is a new transaction and the transaction has an
amount, it sends a notification to the user */
class NewTransactionAssetTrigger extends TriggerBase<{
  chain: string | string[];
  from?: string;
  to?: string;
  assetID?: string;
}> {
  /**
   * The function subscribes to the Algorand blockchain and waits for a new transaction to be sent from
   * the sender address to the recipient address. If the transaction is a new transaction and the
   * transaction has an amount, the function sends a notification to the user
   */
  async main() {
    if (!this.fields.from && !this.fields.to) {
      throw new InvalidParamsError("from or to is required");
    }
    console.log(`[${this.sessionId}] NewTransactionAssetTrigger:`, this.fields.chain, this.fields.from, this.fields.to);
    /* The above code is subscribing to the Algorand blockchain and listening for asset transfers. */
    const unsubscribe = SUBSCRIBER.subscribe({
      callback: async (tx: Txn) => {
        /* Checking if the transaction is a payment or an asset transfer. */
        if (tx.txn.txn.type !== "axfer") {
          return;
        }
        /* Checking if the transaction is from the correct sender. */
        if (this.fields.from && this.fields.from !== algosdk.encodeAddress(tx.txn.txn.snd)) {
          return;
        }
        /* Checking if the recipient address matches
        the address we are looking for. */
        if (this.fields.to && tx.txn.txn.rcv && this.fields.to !== algosdk.encodeAddress(tx.txn.txn.rcv)) {
          return;
        }
        /* Checking if the transaction is a new transaction and if the transaction has an amount. */
        if (!("aamt" in tx.txn.txn)) {
          return;
        }
        /* Creating a new instance of the SignedTransactionWithAD class. */
        const stwad = new SignedTransactionWithAD(
          tx.blockgh,
          tx.blockgen,
          tx.txn
        );
        /* Getting the transaction details from the transaction object. */
        const tx_from = algosdk.encodeAddress(tx.txn.txn.snd);
        const tx_id = stwad.txn.txn.txID();
        const tx_to = algosdk.encodeAddress(tx.txn.txn.arcv);
        const assetInfo = await arApi(["assets", tx.txn.txn.xaid.toString()]);
        const tx_amount = (new BigNumber(tx.txn.txn.aamt).div(
          new BigNumber(10).pow(new BigNumber(assetInfo.params.decimals.toString()))
        )).toString();
        /* Checking if the assetID is the same as the assetInfo.index.toString() */
        if (this.fields.assetID && this.fields.assetID !== assetInfo.index.toString()) {
          return;
        }
        /* Printing the transaction details to the console. */
        console.log("from", tx_from);
        console.log("to", tx_to);
        console.log("amount", tx_amount);
        console.log("txID", tx_id);
        console.log("blockHash", tx.blockHash);
        console.log("blockRnd", tx.blockRnd?.toString());
        console.log("assetInfo", assetInfo);
        /* Sending a notification to the user. */
        this.sendNotification({
          from: tx_from,
          to: tx_to,
          amount: tx_amount,
          txHash: tx_id,
          blockHash: tx.blockHash,
          blockHeight: tx.blockRnd?.toString(),
          index: assetInfo.index.toString(),
          clawback: assetInfo.params.clawback,
          creator: assetInfo.params.creator,
          decimals: assetInfo.params.decimals.toString(),
          freeze: assetInfo.params.freeze,
          manager: assetInfo.params.manager,
          name: assetInfo.params.name,
          reserve: assetInfo.params.reserve,
          total: assetInfo.params.total.toString(),
          unitname: assetInfo.params["unit-name"]
        });
      },
      /* A callback function that is called when an error occurs. */
      onError: (error: unknown) => {
        this.interrupt(error);
      },
    });
   /* Waiting for the stop event to occur and then unsubscribing from the event. */
    try {
      await this.waitForStop();
    } finally {
      unsubscribe();
    }
  }
}
/* It subscribes to the `SUBSCRIBER` and sends a notification whenever a transaction of the specified
type is received */
class NewEventTrigger extends TriggerBase<{
  chain: string | string[];
  contractAddress?: string;
  eventDeclaration: string | string[];
  parameterFilters: { [key: string]: unknown };
}> {
  /**
   * It subscribes to the event stream, and when it sees an event that matches the parameters, it sends
   * a notification
   */
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
    /* Subscribing to the Algorand blockchain and sending a notification when a transaction is
    received. */
    const unsubscribe = SUBSCRIBER.subscribe({
      callback: async (tx: Txn) => {
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
/* Creating a map of triggers that can be used by the connector. */
export const Triggers = new Map<string, new (params: ConnectorInput) => TriggerBase>();
Triggers.set("newTransaction", NewTransactionTrigger);
Triggers.set("newTransactionAsset", NewTransactionAssetTrigger);
Triggers.set("newEvent", NewEventTrigger);
/**
 * It takes in a function declaration and parameters, and then calls the corresponding function in the
 * smart contract
 * @param input - The input object that the frontend sends to the backend.
 * @returns the asset information in a format that the frontend can understand.
 */
export async function callSmartContract(
  input: ConnectorInput<{
    chain: string;
    contractAddress: string;
    functionDeclaration: string;
    parameters: { [key: string]: unknown };
    maxFeePerGas?: string | number;
    maxPriorityFeePerGas?: string | number;
    gasLimit?: string | number; // Note: This is in ETH instead of gas unit
    dryRun?: boolean;
    userToken: string;
  }>
): Promise<ConnectorOutput> {
  // Verify the userToken is valid
  const user = await parseUserAccessToken(input.fields.userToken).catch(() => null);
  if (!user) {
    throw new Error("User token is invalid");
  }
  const algodClient = await getAlgodClient(input.fields.chain);
  /* The above code is using the Algorand Standard Asset API to get information about an asset. */
  if (input.fields.functionDeclaration === "getInformationAsset") {
    const scrutinizedAsset = await arApi(["assets", input.fields.parameters.assetid as string]);
    /* Printing out the values of the fields of the scrutinizedAsset object. */
    console.log("index", scrutinizedAsset.index.toString());
    console.log("clawback", scrutinizedAsset.params.clawback);
    console.log("creator", scrutinizedAsset.params.creator);
    console.log("decimals", scrutinizedAsset.params.decimals.toString());
    console.log("freeze", scrutinizedAsset.params.freeze);
    console.log("manager", scrutinizedAsset.params.manager);
    console.log("name", scrutinizedAsset.params.name);
    console.log("reserve", scrutinizedAsset.params.reserve);
    console.log("total", scrutinizedAsset.params.total.toString());
    console.log("unit-name", scrutinizedAsset.params["unit-name"]);
    /* Returning the asset information in a format that the frontend can understand. */
    return {
      key: input.key,
      sessionId: input.sessionId,
      payload: {
        index: scrutinizedAsset.index.toString(),
        clawback: scrutinizedAsset.params.clawback,
        creator: scrutinizedAsset.params.creator,
        decimals: scrutinizedAsset.params.decimals.toString(),
        freeze: scrutinizedAsset.params.freeze,
        manager: scrutinizedAsset.params.manager,
        name: scrutinizedAsset.params.name,
        reserve: scrutinizedAsset.params.reserve,
        total: scrutinizedAsset.params.total.toString(),
        unitname: scrutinizedAsset.params["unit-name"]
      },
    };
  }

  // Get user account
  const userAccount = await getUserAccountAlgorand(user);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const grinderyAccount = algosdk.mnemonicToSecretKey(process.env.ALGORAND_MNEMONIC_GRINDERY!);

  // Set new atomicTransactionComposer
  const comp = new algosdk.AtomicTransactionComposer();

  // Set the three accounts: sender (user), intermediary to pay gas fees (grindery) and receiver
  // const sender = userAccount.addr;
  // const intermediary = grinderyAccount.addr;
  const receiver = input.fields.contractAddress;

  // Set depay parameters for Algorand
  const depayparameter: DepayActions<AlgorandDepayActions> = {
    fields: {
      comp,
      algodClient,
      userAccount,
      grinderyAccount,
      receiver,
    },
  };

  /* Sending a transaction to the blockchain. */
  return await SendTransactionAction(input, depayparameter);
}

export async function getUserDroneAddress(_user: TAccessToken): Promise<string> {
  throw new Error("Not implemented");
}