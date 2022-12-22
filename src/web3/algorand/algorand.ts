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
        if ((this.key === "newTransaction" && tx.txn.txn.type !== "pay")
        || (this.key === "newTransactionAsset" && tx.txn.txn.type !== "axfer")) {
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
        if ((this.key === "newTransaction" && !("amt" in tx.txn.txn))
        || (this.key === "newTransactionAsset" && !("aamt" in tx.txn.txn))) {
          return;
        }
        /* Creating a new instance of the SignedTransactionWithAD class. */
        const stwad = new SignedTransactionWithAD(
          tx.blockgh,
          tx.blockgen,
          tx.txn
        );
        const tx_from = algosdk.encodeAddress(tx.txn.txn.snd);
        const tx_id = stwad.txn.txn.txID();
        let tx_to = "";
        let tx_amount = "";
        /* Converting the transaction amount from microalgos to algos. */
        if (this.key === "newTransaction") {
          tx_to = algosdk.encodeAddress(tx.txn.txn.rcv);
          tx_amount = (new BigNumber(tx.txn.txn.amt).div(
            new BigNumber(10).pow(new BigNumber(6))
          )).toString();
        }
        /* The above code is checking if the transaction is an asset transfer. If it is, it will get
        the asset information from the Algorand blockchain. */
        let assetInfo = {} as AssetParams;
        if (this.key === "newTransactionAsset") {
          tx_to = algosdk.encodeAddress(tx.txn.txn.arcv);
          assetInfo = await arApi(["assets", tx.txn.txn.xaid.toString()]);
          tx_amount = (new BigNumber(tx.txn.txn.aamt).div(
            new BigNumber(10).pow(new BigNumber(assetInfo.params.decimals.toString()))
          )).toString();
        }
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
          blockHeight: tx.blockRnd?.toString(),
          assetInfo
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
Triggers.set("newTransactionAsset", NewTransactionTrigger);
Triggers.set("newEvent", NewEventTrigger);

/*
const createAccount = function () {
  try {
    const userAccount = algosdk.generateAccount();
    console.log("Account Address = " + userAccount.addr);
    const account_mnemonic = algosdk.secretKeyToMnemonic(userAccount.sk);
    console.log("Account Mnemonic = " + account_mnemonic);
    console.log("Account created. Save off Mnemonic and address");
    console.log("Add funds to account using the TestNet Dispenser: ");
    console.log("https://dispenser.testnet.aws.algodev.network/ ");
    return userAccount;
  } catch (err) {
    console.log("err", err);
  }
};
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
    // const accountInfo = await algodClient.accountInformation(input.fields.contractAddress).do();
    // for (let idx = 0; idx < accountInfo["created-assets"].length; idx++) {
    //   const scrutinizedAsset = accountInfo["created-assets"][idx];
    //   if (scrutinizedAsset["index"] === input.fields.parameters.assetid) {

        const scrutinizedAsset = await arApi(["assets", input.fields.parameters.assetid as string]);

        // console.log("symbol", scrutinizedAsset["params"]["unit-name"]);
        // console.log("name", scrutinizedAsset["params"].name);
        // console.log("decimals", scrutinizedAsset["params"].decimals);
        // console.log("creator", scrutinizedAsset["params"].creator);
        // console.log("assetid", scrutinizedAsset["index"]);

        console.log("scrutinizedAsset", scrutinizedAsset);

        return {
          key: input.key,
          sessionId: input.sessionId,
          payload: {
            index: scrutinizedAsset.index,
            scrutinizedAsset
            // symbol: scrutinizedAsset["params"]["unit-name"],
            // name: scrutinizedAsset["params"].name,
            // decimals: scrutinizedAsset["params"].decimals,
            // creator: scrutinizedAsset["params"].creator,
            // assetid: scrutinizedAsset["index"]
          },
        };
   /*  */
    //   }
    // }
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

  return await SendTransactionAction(input, depayparameter);
}

export async function getUserDroneAddress(_user: TAccessToken): Promise<string> {
  throw new Error("Not implemented");
}