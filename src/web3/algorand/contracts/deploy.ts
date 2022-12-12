/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
// import * as dotenv from "dotenv";
import algosdk from "algosdk";
import { TextEncoder } from "util";
import { open } from "node:fs/promises";
import "dotenv/config";

const baseServer = "https://testnet-algorand.api.purestake.io/ps2";
const port = "";
const token = {
  "X-API-Key": process.env.ALGORAND_API_KEY!,
};

const algodClient = new algosdk.Algodv2(token, baseServer, port);

const myaccount = algosdk.mnemonicToSecretKey(process.env.ALGORAND_MNEMONIC!);
const sender = myaccount.addr;

// helper function to compile program source
async function compileProgram(client: any, TealSource: any) {
  const encoder = new TextEncoder();
  const programBytes = encoder.encode(TealSource);
  const compileResponse = await client.compile(programBytes).do();
  const compiledBytes = new Uint8Array(
    Buffer.from(compileResponse.result, "base64")
  );
  return compiledBytes;
}

(async () => {
  try {
    const localInts = 0;
    const localBytes = 0;
    const globalInts = 1;
    const globalBytes = 0;

    const approvalProgramfile = await open(
      "./src/web3/algorand/contracts/txntest/approval.teal"
    );
    const clearProgramfile = await open(
      "./src/web3/algorand/contracts/txntest/clear.teal"
    );

    const approvalProgram = await approvalProgramfile.readFile();
    const clearProgram = await clearProgramfile.readFile();

    const approvalProgramBinary = await compileProgram(
      algodClient,
      approvalProgram
    );
    const clearProgramBinary = await compileProgram(algodClient, clearProgram);

    const params = await algodClient.getTransactionParams().do();
    const onComplete = algosdk.OnApplicationComplete.NoOpOC;

    console.log("Deploying Application. . . . ");

    const txn = algosdk.makeApplicationCreateTxn(
      sender,
      params,
      onComplete,
      approvalProgramBinary,
      clearProgramBinary,
      localInts,
      localBytes,
      globalInts,
      globalBytes
    );
    const txId = txn.txID().toString();

    // Sign the transaction
    const signedTxn = txn.signTxn(myaccount.sk);
    console.log("Signed transaction with txID: %s", txId);

    // Submit the transaction
    await algodClient.sendRawTransaction(signedTxn).do();

    // Wait for confirmation
    await algosdk.waitForConfirmation(algodClient, txId, 2);

    // print the app-id
    const transactionResponse = await algodClient
      .pendingTransactionInformation(txId)
      .do();
    const appId = transactionResponse["application-index"];
    console.log("Created new with app-id: ", appId);
  } catch (err) {
    console.error("Failed to deploy!", err);
    process.exit(1);
  }
})();
