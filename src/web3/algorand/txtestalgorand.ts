import { ConnectorInput, ConnectorOutput } from "grindery-nexus-common-utils/dist/connector";
import { DepayActions, AlgorandDepayActions } from "../utils";
import { parseFunctionDeclarationAlgorand, setSpFee } from "./utils";
import algosdk, { Transaction } from "algosdk";

export async function SendTransactionAction(
  input: ConnectorInput<{
    chain: string;
    contractAddress: string;
    functionDeclaration: string;
    parameters: { [key: string]: unknown };
    maxFeePerGas?: string | number;
    maxPriorityFeePerGas?: string | number;
    gasLimit?: string | number;
    dryRun?: boolean;
  }>,
  depay: DepayActions<AlgorandDepayActions>
): Promise<ConnectorOutput> {
  // We initialize the common parameters here, they'll be passed to all the transactions
  // since they happen to be the same
  const spNoFee = await setSpFee(0, depay.fields.algodClient);
  const spFullFee = await setSpFee(3 * algosdk.ALGORAND_MIN_TX_FEE, depay.fields.algodClient);

  depay.fields.comp.addTransaction({
    // Transaction from the user to the dApp (amount = 0 and fees = 0)
    txn: algosdk.makePaymentTxnWithSuggestedParams(
      depay.fields.userAccount.addr,
      depay.fields.receiver,
      0,
      undefined,
      undefined,
      spNoFee
    ),
    signer: algosdk.makeBasicAccountTransactionSigner(depay.fields.userAccount),
  });

  depay.fields.comp.addMethodCall({
    appID: Number(process.env.ALGORAND_APP_ID || ""),
    method: parseFunctionDeclarationAlgorand(input.fields.functionDeclaration),
    methodArgs: [
      0,
      {
        txn: new Transaction({
          from: depay.fields.grinderyAccount.addr,
          to: depay.fields.receiver,
          amount: 0,
          ...spNoFee,
        }),
        signer: algosdk.makeBasicAccountTransactionSigner(depay.fields.grinderyAccount),
      },
      0,
    ],
    ...{
      sender: depay.fields.grinderyAccount.addr,
      suggestedParams: spFullFee,
      signer: algosdk.makeBasicAccountTransactionSigner(depay.fields.grinderyAccount),
    },
  });

  return {
    key: input.key,
    sessionId: input.sessionId,
    // Finally, execute the composed group and print out the results
    payload: await depay.fields.comp.execute(depay.fields.algodClient, 2),
  };
}
