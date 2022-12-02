import { hmac, TAccessToken } from "../../jwt";
import nacl, { randomBytes } from 'tweetnacl';
import * as jose from "jose";
import Web3 from "web3";
import { AbiItem, AbiInput, AbiOutput, StateMutabilityType, AbiType } from "web3-utils";
import { BlockTransactionObject } from "web3-eth";
import algosdk from "algosdk";
import { getNetworkId } from "../utils";
import AlgodClient from "algosdk/dist/types/src/client/v2/algod/algod";

export async function getUserAccountAlgorand(user: TAccessToken): Promise<algosdk.Account> {

    const lengthSecretKey = nacl.box.secretKeyLength;
    const seed = (await hmac("grindery-algorand-key/" + user.sub)).subarray(0, lengthSecretKey);
    const keypair = nacl.sign.keyPair.fromSeed(seed);
    const encodedPk = algosdk.encodeAddress(keypair.publicKey);

    return { addr: encodedPk, sk: keypair.secretKey };

}

export function parseFunctionDeclarationAlgorand(functionDeclaration: string): algosdk.ABIMethod {

    const m = /^\s*(function +)?([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*(.*)$/.exec(functionDeclaration);
    if (!m) {
        throw new Error("Invalid function declaration");
    }
    const name = m[2];
    const args:algosdk.ABIMethodArgParams[] = m[3].split(",").map((p) => {
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

    return new algosdk.ABIMethod({name:name, args:args, returns:returns[0]});

}

export async function getAlgodClient(chain: string) {

    const networkId = await getNetworkId(chain);
    const baseServer = `https://${networkId}-algorand.api.purestake.io/ps2`;
    const port = '';
    const token = {'X-API-Key': process.env.ALGORAND_API_KEY!}

    return new algosdk.Algodv2(token, baseServer, port); 
}

export async function setSpFee(fees: number, algodClient: algosdk.Algodv2) {

    const sp = await algodClient.getTransactionParams().do();
    sp.flatFee = true;
    sp.fee = fees;

    return sp;
}

export async function getbalance(
    account: algosdk.Account, 
    algodClient: algosdk.Algodv2
): Promise<any> {
    let accountInfo = await algodClient.accountInformation(account.addr).do();
    return accountInfo.amount;
} 

export async function feedAccount(
    from: algosdk.Account, 
    to: algosdk.Account, 
    amount: number | bigint,
    algodClient: algosdk.Algodv2,
) : Promise<Record<string, any>> {

    // Check balances
    console.log("Grindery account balance: %d microAlgos", await getbalance(from, algodClient));
    console.log("User account balance: %d microAlgos", await getbalance(to, algodClient));

    // Transaction to feed the user account
    const txnToFeedUser = algosdk.makePaymentTxnWithSuggestedParams(
        from.addr, 
        to.addr, 
        amount, 
        undefined, 
        undefined, 
        await setSpFee(algosdk.ALGORAND_MIN_TX_FEE, algodClient)
    );

    let signedTxn = txnToFeedUser.signTxn(from.sk);
    let txId = txnToFeedUser.txID().toString();
    console.log("Signed transaction with txID: %s", txId);

    // Submit the transaction
    await algodClient.sendRawTransaction(signedTxn).do();

    // Wait for confirmation
    let confirmedTxn = await algosdk.waitForConfirmation(algodClient, txId, 4);
    //Get the completed Transaction
    console.log("Transaction " + txId + " confirmed in round " + confirmedTxn["confirmed-round"]);
    // let mytxinfo = JSON.stringify(confirmedTxn.txn.txn, undefined, 2);
    // console.log("Transaction information: %o", mytxinfo);
    let string = new TextDecoder().decode(confirmedTxn.txn.txn.note);
    console.log("Note field: ", string);
    
    // Check balances
    console.log("Grindery account balance: %d microAlgos", await getbalance(from, algodClient));
    console.log("User account balance: %d microAlgos", await getbalance(to, algodClient));


    console.log("Transaction Amount: %d microAlgos", confirmedTxn.txn.txn.amt);        
    console.log("Transaction Fee: %d microAlgos", confirmedTxn.txn.txn.fee);

    return confirmedTxn;

}
