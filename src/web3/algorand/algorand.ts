import { EventEmitter } from "node:events";
import _ from "lodash";
import axios from "axios";
import { ConnectorInput, ConnectorOutput, TriggerBase } from "grindery-nexus-common-utils/dist/connector";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import { hmac, parseUserAccessToken, TAccessToken } from "../../jwt";
import Web3 from "web3";
import algosdk, { decodeAddress, Transaction } from "algosdk";
import { getWeb3 } from "../evm/web3";
import * as fs from "fs";
import { getUserAddress, parseFunctionDeclaration, HUB_ADDRESS } from "../evm/utils";
import { getUserAccountAlgorand, 
  parseFunctionDeclarationAlgorand,
  getAlgodClient,
  setSpFee 
} from "./utils"; 
import { UnicodeNormalizationForm } from "ethers/lib/utils";
import {SendTransactionAction} from "../actions";
import {DepayActions, AlgorandDepayActions} from "../utils";


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
interface Txn {
  hgi?: boolean;
  sig?: string;
  txn: TxnDetails;
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

async function arApi(path: "status"): Promise<Status>;
async function arApi(path: ["blocks", string]): Promise<BlockResponse>;
async function arApi(path: string | string[]): Promise<unknown> {
  if (Array.isArray(path)) {
    path = path.join("/");
  }
  const response = await axios.get("https://node.algoexplorerapi.io/v2/" + path);
  return response.data;
}

class TransactionSubscriber extends EventEmitter {
  private running = false;
  constructor() {
    super();
    this.setMaxListeners(1000);
  }
  async handleBlock(block: BlockResponse) {
    for (const txn of block.block.txns) {
      for (const listener of this.listeners("process")) {
        await listener(txn);
      }
    }
  }
  async main() {
    if (this.running) {
      return;
    }
    const status = await arApi("status");
    let currentHeight = status["last-round"];
    this.running = true;
    while (this.listenerCount("process") > 0) {
      try {
        const response = await arApi(["blocks", currentHeight.toString()]);
        await this.handleBlock(response);
        currentHeight++;
      } catch (e) {
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

class NewTransactionTrigger extends TriggerBase<{ chain: string | string[]; from?: string; to?: string }> {
  async main() {
    if (!this.fields.from && !this.fields.to) {
      throw new InvalidParamsError("from or to is required");
    }
    console.log(`[${this.sessionId}] NewTransactionTrigger:`, this.fields.chain, this.fields.from, this.fields.to);
    const unsubscribe = SUBSCRIBER.subscribe({
      callback: async (tx: Txn) => {
        if (tx.txn.type !== "pay") {
          return;
        }
        if (this.fields.from && this.fields.from !== tx.txn.snd) {
          return;
        }
        if (this.fields.to && this.fields.to !== tx.txn.rcv) {
          return;
        }
        if (!("amt" in tx.txn)) {
          return;
        }
        this.sendNotification({
          _grinderyChain: this.fields.chain,
          from: tx.txn.snd,
          to: tx.txn.rcv,
          value: tx.txn.amt,
          ...tx.txn,
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
Triggers.set("newEvent", NewEventTrigger);

const createAccount = function() {
  try {  
    const userAccount = algosdk.generateAccount();
    console.log("Account Address = " + userAccount.addr);
    let account_mnemonic = algosdk.secretKeyToMnemonic(userAccount.sk);
    console.log("Account Mnemonic = "+ account_mnemonic);
    console.log("Account created. Save off Mnemonic and address");
    console.log("Add funds to account using the TestNet Dispenser: ");
    console.log("https://dispenser.testnet.aws.algodev.network/ ");
    return userAccount;
  }
  catch (err) {
      console.log("err", err);
  }
};

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

  console.log("algorand début"); //

  const user = await parseUserAccessToken(input.fields.userToken).catch(() => null);
  if (!user) {
    throw new Error("User token is invalid");
  }

  const userAccount = await getUserAccountAlgorand(user);
  const grinderyAccount = algosdk.mnemonicToSecretKey(process.env.ALGORAND_MNEMONIC_GRINDERY!);
  const algodClient = await getAlgodClient(input.fields.chain);

  // Set new atomicTransactionComposer
  const comp = new algosdk.AtomicTransactionComposer();

  const sender = userAccount.addr;
  const intermediary = grinderyAccount.addr;
  const receiver = input.fields.contractAddress;

  console.log("test1")

  // // We initialize the common parameters here, they'll be passed to all the transactions
  // // since they happen to be the same
  // const spNoFee = await setSpFee(0, algodClient);
  // const spFullFee = await setSpFee(3 * algosdk.ALGORAND_MIN_TX_FEE, algodClient);

  // // Transaction from the user to the dApp (amount = 0 and fees = 0)
  // const txn = algosdk.makePaymentTxnWithSuggestedParams(
  //   sender, 
  //   receiver!, 
  //   0, 
  //   undefined, 
  //   undefined, 
  //   spNoFee
  // );

  // comp.addTransaction({
  //   txn: txn,
  //   signer: algosdk.makeBasicAccountTransactionSigner(userAccount)
  // });

  // const commonParamsFullFee = {
  //   sender: grinderyAccount.addr,
  //   suggestedParams: spFullFee,
  //   signer: algosdk.makeBasicAccountTransactionSigner(grinderyAccount),
  // };

  // comp.addMethodCall({
  //   appID: Number(process.env.ALGORAND_APP_ID!),
  //   method: parseFunctionDeclarationAlgorand(input.fields.functionDeclaration),
  //   // method: test,
  //   methodArgs: [
  //     0,
  //     {
  //       txn: new Transaction({
  //         from: intermediary!,
  //         to: receiver,
  //         amount: 0,
  //         ...spNoFee,
  //       }),
  //       signer: algosdk.makeBasicAccountTransactionSigner(grinderyAccount!),
  //     },
  //     0,
  //   ],
  //   ...commonParamsFullFee,
  // });

  // // Finally, execute the composed group and print out the results
  // let result: any = await comp.execute(algodClient, 2);

  // console.log("result", result);

  // return {
  //   key: input.key,
  //   sessionId: input.sessionId,
  //   payload: result,
  // };


  const depayparameter: DepayActions<AlgorandDepayActions> = {
    fields: {
      comp: comp,
      algodClient: algodClient,
      userAccount: userAccount,
      grinderyAccount: grinderyAccount,
      receiver: receiver
    }
  }


  return await SendTransactionAction(input, depayparameter)

  console.log("callSmartContract", input);
  throw new Error("Not implemented");
  
}

export async function getUserDroneAddress(_user: TAccessToken): Promise<string> {
  throw new Error("Not implemented");
}


