import { hmac, TAccessToken } from "../../jwt";
import nacl from "tweetnacl";
import algosdk from "algosdk";
import { getNetworkId } from "../utils";
import * as msgpack from "algo-msgpack-with-bigint";
import sha512 from "js-sha512";


/**
 * It takes a user's access token and returns an Algorand account
 * @param {TAccessToken} user - TAccessToken - the user object that is passed to the function.
 * @returns an object with two properties: addr and sk.
 */
export async function getUserAccountAlgorand(
  user: TAccessToken
): Promise<algosdk.Account> {
  const lengthSecretKey = nacl.box.secretKeyLength;
  const seed = (await hmac("grindery-algorand-key/" + user.sub)).subarray(
    0,
    lengthSecretKey
  );
  const keypair = nacl.sign.keyPair.fromSeed(seed);
  const encodedPk = algosdk.encodeAddress(keypair.publicKey);

  return { addr: encodedPk, sk: keypair.secretKey };
}

/**
 * It takes a string that looks like a function declaration in TypeScript, and returns an object that
 * looks like an ABIMethod
 * @param {string} functionDeclaration - The function declaration string.
 * @returns ABIMethod
 */
export function parseFunctionDeclarationAlgorand(
  functionDeclaration: string
): algosdk.ABIMethod {
  const m = /^\s*(function +)?([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*(.*)$/.exec(
    functionDeclaration
  );
  if (!m) {
    throw new Error("Invalid function declaration");
  }
  const name = m[2];
  const args: algosdk.ABIMethodArgParams[] = m[3].split(",").map((p) => {
    const parts = p.trim().split(/\s+/);
    if (parts.length < 2) {
      throw new Error("Invalid function declaration: Invalid parameter " + p);
    }
    return {
      type: parts[0],
      name: parts[parts.length - 1],
    };
  });
  const returnMatch = /\breturns\s+\(([^)]+)\)/.exec(m[4]);
  const returns = returnMatch
    ? returnMatch[1].split(",").map((p, index) => {
        const parts = p.trim().split(/\s+/);
        return {
          type: parts[0],
          name: parts[1] || `return${index}`,
        };
      })
    : [];

  return new algosdk.ABIMethod({ name, args, returns: returns[0] });
}

/**
 * It returns an Algod client that can be used to make requests to the Algorand network
 * @param {string} chain - The chain you want to connect to.
 * @returns A new Algodv2 client
 */
export async function getAlgodClient(chain: string) {
  const networkId = await getNetworkId(chain);
  const baseServer = `https://${networkId}-algorand.api.purestake.io/ps2`;
  const port = "";
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const token = { "X-API-Key": process.env.ALGORAND_API_KEY! };

  return new algosdk.Algodv2(token, baseServer, port);
}

/**
 * This function takes in a number and an algodClient and returns a transaction parameter object with
 * the flatFee set to true and the fee set to the number passed in
 * @param {number} fees - The fee you want to set.
 * @param algodClient - The Algod client object.
 * @returns The transaction parameters are being returned.
 */
export async function setSpFee(fees: number, algodClient: algosdk.Algodv2) {
  const sp = await algodClient.getTransactionParams().do();
  sp.flatFee = true;
  sp.fee = fees;

  return sp;
}

/**
 * This function takes an account and an algodClient as input, and returns the balance of the account
 * @param account - The account object that you created earlier.
 * @param algodClient - The Algod client object that you created in the previous step.
 * @returns The balance of the account.
 */
export async function getbalance(
  account: algosdk.Account,
  algodClient: algosdk.Algodv2
): Promise<unknown> {
  const accountInfo = await algodClient.accountInformation(account.addr).do();
  return accountInfo.amount;
}

/**
 * It takes an account that has funds, and sends a transaction to another account
 * @param from - The account that will be sending the payment.
 * @param to - The address of the user account
 * @param {number | bigint} amount - The amount of microAlgos to send to the user.
 * @param algodClient - The Algorand client object
 * @returns The confirmed transaction.
 */
export async function feedAccount(
  from: algosdk.Account,
  to: algosdk.Account,
  amount: number | bigint,
  algodClient: algosdk.Algodv2
): Promise<Record<string, unknown>> {
  // Check balances
  console.log(
    "Grindery account balance: %d microAlgos",
    await getbalance(from, algodClient)
  );
  console.log(
    "User account balance: %d microAlgos",
    await getbalance(to, algodClient)
  );

  // Transaction to feed the user account
  const txnToFeedUser = algosdk.makePaymentTxnWithSuggestedParams(
    from.addr,
    to.addr,
    amount,
    undefined,
    undefined,
    await setSpFee(algosdk.ALGORAND_MIN_TX_FEE, algodClient)
  );

  const signedTxn = txnToFeedUser.signTxn(from.sk);
  const txId = txnToFeedUser.txID().toString();
  console.log("Signed transaction with txID: %s", txId);

  // Submit the transaction
  await algodClient.sendRawTransaction(signedTxn).do();

  // Wait for confirmation
  const confirmedTxn = await algosdk.waitForConfirmation(algodClient, txId, 4);
  //Get the completed Transaction
  console.log(
    "Transaction " +
      txId +
      " confirmed in round " +
      confirmedTxn["confirmed-round"]
  );
  // let mytxinfo = JSON.stringify(confirmedTxn.txn.txn, undefined, 2);
  // console.log("Transaction information: %o", mytxinfo);
  const string = new TextDecoder().decode(confirmedTxn.txn.txn.note);
  console.log("Note field: ", string);

  // Check balances
  console.log(
    "Grindery account balance: %d microAlgos",
    await getbalance(from, algodClient)
  );
  console.log(
    "User account balance: %d microAlgos",
    await getbalance(to, algodClient)
  );

  console.log("Transaction Amount: %d microAlgos", confirmedTxn.txn.txn.amt);
  console.log("Transaction Fee: %d microAlgos", confirmedTxn.txn.txn.fee);

  return confirmedTxn;
}

// class StateDelta {
//   action: number = 0;
//   bytes: Uint8Array = new Uint8Array();
//   uint: number | undefined = undefined;

//   static fromMsgp(state_delta: any): StateDelta {
//     const sd = new StateDelta();
//     if ("at" in state_delta) sd.action = state_delta["at"];
//     if ("bs" in state_delta) sd.bytes = state_delta["bs"];
//     if ("ui" in state_delta) sd.uint = state_delta["ui"];
//     return sd;
//   }

//   get_obj_for_encoding() {
//     const obj: any = {};
//     if (this.action !== 0) obj["at"] = this.action;
//     if (this.bytes.length > 0) obj["bs"] = this.bytes;
//     if (this.uint !== undefined) obj["ui"] = this.uint;
//     return obj;
//   }
// }

// class EvalDelta {
//   global_delta: StateDelta[] = [];
//   local_deltas: { [key: number]: StateDelta[] } = {};
//   logs: string[] = [];
//   inner_txns: SignedTransactionWithAD[] = [];

//   constructor(o: {
//     global_delta?: StateDelta[];
//     local_deltas?: { [key: number]: StateDelta[] };
//     logs?: string[];
//     inner_txns?: SignedTransactionWithAD[];
//   }) {}

//   static fromMsgp(delta: any): EvalDelta {
//     const ed = new EvalDelta({});

//     if ("gd" in delta) {
//       for (const idx of delta["gd"]) {
//         ed.global_delta.push(StateDelta.fromMsgp(delta["gd"]));
//       }
//     }

//     if ("ld" in delta) {
//       for (const k of delta["ld"]) {
//         ed.local_deltas[k].push(StateDelta.fromMsgp(delta["ld"][k]));
//       }
//     }

//     if ("itx" in delta) {
//       for (const itxn of delta["itx"]) {
//         ed.inner_txns.push(
//           new SignedTransactionWithAD(Buffer.from(""), "", itxn)
//         );
//       }
//     }

//     if ("lg" in delta) ed.logs = delta["lg"];

//     return ed;
//   }

//   get_obj_for_encoding() {
//     const obj: any = {};

//     if (this.global_delta.length > 0)
//       obj["gd"] = this.global_delta.map((gd) => {
//         return gd.get_obj_for_encoding();
//       });
//     if (Object.keys(this.local_deltas).length > 0) obj["ld"] = {};
//     if (this.logs.length > 0) obj["lg"] = this.logs;
//     if (this.inner_txns.length > 0)
//       obj["itx"] = this.inner_txns.map((itxn) => {
//         return itxn.get_obj_for_encoding();
//       });

//     return obj;
//   }
// }

// class ApplyData {
//   closing_amount: number = 0;
//   asset_closing_amount: number = 0;
//   sender_rewards: number = 0;
//   receiver_rewards: number = 0;
//   close_rewards: number = 0;
//   eval_delta: EvalDelta | undefined = undefined;
//   config_asset: number = 0;
//   application_id: number = 0;

//   constructor(o: {
//     closing_amount?: 0;
//     asset_closing_amount?: 0;
//     sender_rewards?: 0;
//     receiver_rewards?: 0;
//     close_rewards?: 0;
//     eval_delta?: undefined;
//     config_asset?: 0;
//     application_id?: 0;
//   }) {}

//   static fromMsgp(apply_data: any): ApplyData {
//     const ad = new ApplyData({});

//     if ("ca" in apply_data) ad.closing_amount = apply_data["ca"];
//     if ("aca" in apply_data) ad.asset_closing_amount = apply_data["aca"];
//     if ("rs" in apply_data) ad.sender_rewards = apply_data["rs"];
//     if ("rr" in apply_data) ad.receiver_rewards = apply_data["rr"];
//     if ("rc" in apply_data) ad.close_rewards = apply_data["rc"];
//     if ("caid" in apply_data) ad.config_asset = apply_data["caid"];
//     if ("apid" in apply_data) ad.application_id = apply_data["apid"];
//     if ("dt" in apply_data)
//       ad.eval_delta = EvalDelta.fromMsgp(apply_data["dt"]);

//     return ad;
//   }

//   get_obj_for_encoding() {
//     const obj: any = {};

//     if (this.closing_amount !== 0) obj["ca"] = this.closing_amount;
//     if (this.asset_closing_amount !== 0) obj["aca"] = this.asset_closing_amount;
//     if (this.sender_rewards !== 0) obj["rs"] = this.sender_rewards;
//     if (this.receiver_rewards !== 0) obj["rr"] = this.receiver_rewards;
//     if (this.close_rewards !== 0) obj["rc"] = this.close_rewards;
//     if (this.config_asset !== 0) obj["caid"] = this.config_asset;
//     if (this.application_id !== 0) obj["apid"] = this.application_id;
//     if (this.eval_delta !== undefined)
//       obj["dt"] = this.eval_delta.get_obj_for_encoding();

//     return obj;
//   }
// }

export class SignedTransactionWithAD {
  txn: algosdk.SignedTransaction;
  // apply_data: ApplyData | undefined = undefined;

  constructor(gh: Buffer, gen: string, stib: any) {
    const t = stib.txn as algosdk.EncodedTransaction;
    // Manually add gh/gen to construct a correct transaction object
    t.gh = gh;
    t.gen = gen;

    const stxn = {
      txn: algosdk.Transaction.from_obj_for_encoding(t),
    } as algosdk.SignedTransaction;


    if ("sig" in stib) stxn.sig = stib.sig;
    if ("lsig" in stib) stxn.lsig = stib.lsig;
    if ("msig" in stib) stxn.msig = stib.msig;
    if ("sgnr" in stib) stxn.sgnr = stib.sgnr;


    this.txn = stxn;
    
    // this.apply_data = ApplyData.fromMsgp(stib);
  }

  // get_obj_for_encoding() {
  //   const txn: any = this.txn.txn.get_obj_for_encoding();
  //   if (txn.gen !== "") {
  //     delete txn.gen;
  //     delete txn.gh;
  //   }

  //   const obj: any = {
  //     txn: txn,
  //     ...this.apply_data?.get_obj_for_encoding(),
  //   };

  //   if (this.txn.sig) obj["sig"] = this.txn.sig;
  //   if (this.txn.lsig) obj["lsig"] = this.txn.lsig;
  //   if (this.txn.msig) obj["msig"] = this.txn.msig;
  //   if (this.txn.sgnr) obj["sgnr"] = this.txn.sgnr;
  //   if (this.txn.txn.genesisID !== "") obj["hgi"] = true;

  //   return obj;
  // }

  // hash(): Uint8Array {
  //   const obj = encode(this.get_obj_for_encoding());
  //   return hasher(obj);
  // }
}

// async function verifyProofHash(
//   block_number: number,
//   stxn: SignedTransactionWithAD,
//   client: algosdk.Algodv2
// ): Promise<boolean> {
//   const proof = await client.getTransactionProof(block_number, stxn.txn.txn.txID()).do();
//   const generated = Buffer.from(stxn.hash()).toString("base64");
//   return proof.stibhash == generated;
// }

// function hasher(data: Uint8Array): Uint8Array {
//   const tohash = concatArrays(Buffer.from("STIB"), new Uint8Array(data));
//   return new Uint8Array(sha512.sha512_256.array(tohash));
// }

// export function concatArrays(...arrs: ArrayLike<number>[]) {
//   const size = arrs.reduce((sum, arr) => sum + arr.length, 0);
//   const c = new Uint8Array(size);

//   let offset = 0;
//   for (let i = 0; i < arrs.length; i++) {
//     c.set(arrs[i], offset);
//     offset += arrs[i].length;
//   }

//   return c;
// }

// export function encode(obj: Record<string | number | symbol, any>) {
//   // enable the canonical option
//   const options = { sortKeys: true };
//   return msgpack.encode(obj, options);
// }

export function decode(buffer: ArrayLike<number>) {
  return msgpack.decode(buffer);
}