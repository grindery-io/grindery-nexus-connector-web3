
import {
    ConnectorInput,
    ConnectorOutput,
} from "grindery-nexus-common-utils/dist/connector";
import {DepayActions, NearDepayActions} from "../utils";
import {v4 as uuidv4} from 'uuid';
const { transactions, utils } = require("near-api-js");


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
    depay: DepayActions<NearDepayActions>
  ): Promise<ConnectorOutput> { 

    // Make deposit from grindery account to the user account
    await depay.fields.grinderyAccount.sendMoney(depay.fields.userAccount.accountId, await utils.format.parseNearAmount('0.1'));

    // Set arguments for NFT minting
    const args = {
        token_id: uuidv4(), 
        metadata: {
            title: input.fields.parameters.title, 
            description: input.fields.parameters.description, 
            media: input.fields.parameters.media
        }, 
        receiver_id: input.fields.parameters.to
    };

    // Sign and send the transaction using the user account
    const result = await depay.fields.userAccount.signAndSendTransaction({
        receiverId: input.fields.contractAddress,
        actions: [
            transactions.functionCall(
                "nft_mint",
                args,
                10000000000000,
                await utils.format.parseNearAmount('0.1')
            ),
        ],
    });


    console.log("result", result);

    return {
        key: input.key,
        sessionId: input.sessionId,
        payload: {NFTAddress: result.transaction.hash},
        // payload: {NFTAddress: result.transactions.receipt_id}
    };

    throw new Error("Unsupported call");


  }