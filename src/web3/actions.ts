import {
    ActionOutput,
    ConnectorInput,
    ConnectorOutput,
    TriggerBase,
    WebhookParams,
} from "grindery-nexus-common-utils/dist/connector";

import * as nftnear from "./near/nftnear";

const { connect, transactions, KeyPair, keyStores, utils, Account } = require("near-api-js");


  
const ACTIONS: {
    [key: string]: {SendTransactionAction(input: ConnectorInput<unknown>, useraccount: any): Promise<ConnectorOutput>;};
} = {
    "NFTMint": nftnear,
};

export function SendTransactionAction(input: ConnectorInput<unknown>, useraccount: any) {

    console.log("SendTransactionAction")
    console.log("module: " + input.key);
    const module = ACTIONS[input.key.split(':')[1]];
    
    return module.SendTransactionAction(input, useraccount);
}