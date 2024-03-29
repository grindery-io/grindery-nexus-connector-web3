import { hmac, TAccessToken } from "../../jwt";
import nacl from "tweetnacl";
import algosdk from "algosdk";
import { getNetworkId } from "../utils";
import * as msgpack from "algo-msgpack-with-bigint";

/**
 * It takes a user's access token and returns an Algorand account
 * @param {TAccessToken} user - TAccessToken - the user object that is passed to the function.
 * @returns an object with two properties: addr and sk.
 */
export async function getUserAccountAlgorand(user: TAccessToken): Promise<algosdk.Account> {
  const keypair = nacl.sign.keyPair.fromSeed(
    (await hmac("grindery-algorand-key/" + user.sub)).subarray(0, nacl.box.secretKeyLength)
  );

  return { addr: algosdk.encodeAddress(keypair.publicKey), sk: keypair.secretKey };
}

/**
 * It takes a string that looks like a function declaration in TypeScript, and returns an object that
 * looks like an ABIMethod
 * @param {string} functionDeclaration - The function declaration string.
 * @returns ABIMethod
 */
export function parseFunctionDeclarationAlgorand(functionDeclaration: string): algosdk.ABIMethod {
  const m = /^\s*(function +)?([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*(.*)$/.exec(functionDeclaration);
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
  return new algosdk.Algodv2(
    { "X-API-Key": process.env.ALGORAND_API_KEY || "" },
    `https://${await getNetworkId(chain)}-algorand.api.purestake.io/ps2`,
    ""
  );
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
export async function getbalance(account: algosdk.Account, algodClient: algosdk.Algodv2): Promise<unknown> {
  return (await algodClient.accountInformation(account.addr).do()).amount;
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

  // Submit the transaction
  await algodClient.sendRawTransaction(signedTxn).do();

  return await algosdk.waitForConfirmation(algodClient, txId, 4);
}

/* It takes a SignedTransactionWithAD object, and returns a SignedTransaction object */
export class SignedTransactionWithAD {
  txn: algosdk.SignedTransaction;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(gh: Buffer, gen: string, stib: any) {
    const t = stib.txn as algosdk.EncodedTransaction;
    // Manually add gh/gen to construct a correct transaction object
    t.gh = gh;
    t.gen = gen;
    const stxn = {
      txn: algosdk.Transaction.from_obj_for_encoding(t),
    } as algosdk.SignedTransaction;
    if ("sig" in stib) {
      stxn.sig = stib.sig;
    }
    if ("lsig" in stib) {
      stxn.lsig = stib.lsig;
    }
    if ("msig" in stib) {
      stxn.msig = stib.msig;
    }
    if ("sgnr" in stib) {
      stxn.sgnr = stib.sgnr;
    }
    this.txn = stxn;
  }
}

/**
 * It takes a buffer and returns a JavaScript object
 * @param buffer - ArrayLike<number>
 * @returns A function that takes a buffer and returns the decoded messagepack.
 */
export function decode(buffer: ArrayLike<number>) {
  return msgpack.decode(buffer);
}
