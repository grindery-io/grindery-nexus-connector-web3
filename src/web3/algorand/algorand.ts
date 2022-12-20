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
import { transactions } from "near-api-js";
import * as msgpack from "algo-msgpack-with-bigint";
import { PublicKey } from "near-api-js/lib/utils";
import { consoleLogger } from "@influxdata/influxdb-client";
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
// interface Txn {
//   hgi?: boolean;
//   sig?: string;
//   txn: TxnDetails;
//   blockHash?: string;
//   blockRnd?: string;
//   blockgh: Buffer;
//   blockgen: string;
// }


type AnyTransaction = algosdk.PaymentTxn 
| algosdk.KeyRegistrationTxn 
| algosdk.AssetCreateTxn 
| algosdk.AssetConfigTxn 
| algosdk.AssetDestroyTxn 
| algosdk.AssetFreezeTxn 
| algosdk.AssetTransferTxn 
| algosdk.AppCreateTxn 
| algosdk.AppUpdateTxn 
| algosdk.AppDeleteTxn 
| algosdk.AppOptInTxn 
| algosdk.AppCloseOutTxn 
| algosdk.AppClearStateTxn 
| algosdk.AppNoOpTxn 
| algosdk.StateProofTxn;

type Txn = {
  hgi?: boolean;
  sig?: Buffer;
  txn: Record<string, any>;
  blockHash?: string;
  blockRnd?: string;
  blockgh: Buffer;
  blockgen: string;
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

type BlockHashResponse = {
  blockHash: string;
}

async function arApi(path: "status"): Promise<Status>;
async function arApi(path: ["blocks", string]): Promise<BlockResponse>;
async function arApi(path: ["blocks", string, "hash"]): Promise<BlockHashResponse>;
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
        if (e.isAxiosError && e.response?.status === 404)
          continue;
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
        if (tx.txn.txn.type !== "pay") {
          return;
        }
        if (this.fields.from && this.fields.from !== algosdk.encodeAddress(tx.txn.txn.snd)) {
          return;
        }
        if (this.fields.to && tx.txn.txn.rcv && this.fields.to !== algosdk.encodeAddress(tx.txn.txn.rcv)) {
          return;
        }
        if (!("amt" in tx.txn.txn)) {
          return;
        }
        const stwad = new SignedTransactionWithAD(
          tx.blockgh,
          tx.blockgen,
          tx.txn
        );
        const tx_from = algosdk.encodeAddress(tx.txn.txn.snd);
        const tx_to = algosdk.encodeAddress(tx.txn.txn.rcv);
        const tx_amount = new BigNumber(tx.txn.txn.amt).div(
          new BigNumber(10).pow(new BigNumber(6))
        );
        const tx_id = stwad.txn.txn.txID();
        console.log("from", tx_from);
        console.log("to", tx_to);
        console.log("amount", tx_amount.toString());
        console.log("txID", tx_id);
        console.log("blockHash", tx.blockHash);
        console.log("blockRnd", tx.blockRnd?.toString());
        this.sendNotification({
          from: tx_from,
          to: tx_to,
          amount: tx_amount,
          txHash: tx_id,
          blockHash: tx.blockHash,
          blockHeight: tx.blockRnd?.toString(),
        });
        // this.sendNotification({
        //   _grinderyChain: this.fields.chain,
        //   from: tx.txn.snd,
        //   to: tx.txn.rcv,
        //   value: tx.txn.amt,
        //   ...tx.txn,
        // });
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
    // console.log(
    //   `[${this.sessionId}] NewEventTrigger:`,
    //   this.fields.chain,
    //   this.fields.contractAddress,
    //   this.fields.eventDeclaration,
    //   this.fields.parameterFilters
    // );
    // if (this.fields.contractAddress === "0x0") {
    //   delete this.fields.contractAddress;
    // }
    // const unsubscribe = SUBSCRIBER.subscribe({
    //   callback: async (tx: Txn) => {
    //     if (tx.txn.type !== this.fields.eventDeclaration) {
    //       return;
    //     }
    //     if (this.fields.contractAddress) {
    //       if (tx.txn.type === "appl") {
    //         if (tx.txn.apid?.toString() !== this.fields.contractAddress) {
    //           return;
    //         }
    //       } else if ("xaid" in tx.txn) {
    //         if (tx.txn.xaid?.toString() !== this.fields.contractAddress) {
    //           return;
    //         }
    //       } else {
    //         return;
    //       }
    //     }
    //     let args = tx.txn;
    //     const note = "note" in tx.txn ? tx.txn.note : "";
    //     if (note && note.length < 4096) {
    //       try {
    //         const decoded = JSON.parse(Buffer.from(note, "base64").toString("utf-8"));
    //         args = { ...args, ...decoded };
    //       } catch (e) {
    //         // ignore
    //       }
    //     }
    //     for (const [key, value] of Object.entries(this.fields.parameterFilters)) {
    //       if (key.startsWith("_grindery")) {
    //         continue;
    //       }
    //       if (_.get(args, key) !== value) {
    //         return;
    //       }
    //     }
    //     this.sendNotification({
    //       _grinderyChain: this.fields.chain,
    //       ...args,
    //     });
    //   },
    //   onError: (error: unknown) => {
    //     this.interrupt(error);
    //   },
    // });
    // try {
    //   await this.waitForStop();
    // } finally {
    //   unsubscribe();
    // }
  }
}

export const Triggers = new Map<string, new (params: ConnectorInput) => TriggerBase>();
Triggers.set("newTransaction", NewTransactionTrigger);
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

  // Get user account
  const userAccount = await getUserAccountAlgorand(user);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const grinderyAccount = algosdk.mnemonicToSecretKey(process.env.ALGORAND_MNEMONIC_GRINDERY!);
  const algodClient = await getAlgodClient(input.fields.chain);

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


async function main() { 

  const algodClient = await getAlgodClient("algorand:testnet");
  const status = await arApi("status");
  let currentHeight = status["last-round"];
  let block = await algodClient.block(currentHeight).do();

  let stwad:any;
  for (const txn of block.block.txns) {
    console.log("une transaction", txn);
    stwad = new SignedTransactionWithAD(
      block.block.gh,
      block.block.gen,
      txn
    );
  }
}

// main();
