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

  // Transaction from the user to the dApp (amount = 0 and fees = 0)
  const txn = algosdk.makePaymentTxnWithSuggestedParams(
    depay.fields.userAccount.addr,
    depay.fields.receiver,
    0,
    undefined,
    undefined,
    spNoFee
  );

  depay.fields.comp.addTransaction({
    txn,
    signer: algosdk.makeBasicAccountTransactionSigner(depay.fields.userAccount),
  });

  const commonParamsFullFee = {
    sender: depay.fields.grinderyAccount.addr,
    suggestedParams: spFullFee,
    signer: algosdk.makeBasicAccountTransactionSigner(depay.fields.grinderyAccount),
  };

  depay.fields.comp.addMethodCall({
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    appID: Number(process.env.ALGORAND_APP_ID!),
    method: parseFunctionDeclarationAlgorand(input.fields.functionDeclaration),
    // method: test,
    methodArgs: [
      0,
      {
        txn: new Transaction({
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          from: depay.fields.grinderyAccount.addr!,
          to: depay.fields.receiver,
          amount: 0,
          ...spNoFee,
        }),
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        signer: algosdk.makeBasicAccountTransactionSigner(depay.fields.grinderyAccount!),
      },
      0,
    ],
    ...commonParamsFullFee,
  });

  // Finally, execute the composed group and print out the results
  const result = await depay.fields.comp.execute(depay.fields.algodClient, 2);

  console.log("result", result);

  return {
    key: input.key,
    sessionId: input.sessionId,
    payload: result,
  };
}
