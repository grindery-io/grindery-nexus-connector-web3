
import {
    ConnectorInput,
    ConnectorOutput,
} from "grindery-nexus-common-utils/dist/connector";
import {DepayActions, AlgorandDepayActions} from "../utils";
import { getUserAccountAlgorand, 
    parseFunctionDeclarationAlgorand,
    getAlgodClient,
    setSpFee 
  } from "./utils"; 
import {v4 as uuidv4} from 'uuid';
import algosdk, { decodeAddress, Transaction } from "algosdk";


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
        userToken: string;
    }>, 
    depay: DepayActions<AlgorandDepayActions>
  ): Promise<ConnectorOutput> { 


    depay.fields.comp.addMethodCall({
        appID: Number(process.env.ALGORAND_APP_ID!),
        method: parseFunctionDeclarationAlgorand(input.fields.functionDeclaration),
        // method: test,
        methodArgs: [
        0,
        {
            txn: new Transaction({
            from: depay.fields.grinderyAccount.addr!,
            to: depay.fields.receiver,
            amount: 0,
            ...depay.fields.spNoFee,
            }),
            signer: algosdk.makeBasicAccountTransactionSigner(depay.fields.grinderyAccount!),
        },
        0,],
        ...depay.fields.commonParamsFullFee,
    });
    
    // Finally, execute the composed group and print out the results
    let result: any = await depay.fields.comp.execute(depay.fields.algodClient, 2);

    console.log("result", result);

    return {
        key: input.key,
        sessionId: input.sessionId,
        payload: result,
    };

}