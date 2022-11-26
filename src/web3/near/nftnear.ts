
import {
    ActionOutput,
    ConnectorInput,
    ConnectorOutput,
    TriggerBase,
    WebhookParams,
} from "grindery-nexus-common-utils/dist/connector";
import { nearGetAccount } from "./utils";
import {v4 as uuidv4} from 'uuid';
const { connect, transactions, KeyPair, keyStores, utils, Account } = require("near-api-js");


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
    useraccount: any
  ): Promise<ConnectorOutput> { 

    const args = {
        token_id: uuidv4(), 
        metadata: {
            title: input.fields.parameters.title, 
            description: input.fields.parameters.description, 
            media: input.fields.parameters.media
        }, 
        receiver_id: input.fields.parameters.to
    };

    // const account = await nearGetAccount(input.fields.chain, input.fields.contractAddress);

    console.log("tres bon films");
    console.log("args", args);

    const result = await useraccount.signAndSendTransaction({
        receiverId: input.fields.contractAddress,
        actions: [
            transactions.functionCall(
                "nft_mint",
                args,
                10000000000000,
                "10000000000000000000000"
            ),
        ],
    });

    // return result;

    console.log("result", result);

    return {
        key: input.key,
        sessionId: input.sessionId,
        payload: result,
        // payload: {NFTAddress: result.transactions.receipt_id}
    };

    throw new Error("Unsupported call");


  }