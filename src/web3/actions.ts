import {
    ActionOutput,
    ConnectorInput,
    ConnectorOutput,
    TriggerBase,
    WebhookParams,
} from "grindery-nexus-common-utils/dist/connector";

import * as nftnear from "./near/nftnear";
import * as txtestalgorand from "./algorand/txtestalgorand";
import * as nftalgorand from "./algorand/nftalgorand";
import { DepayActions } from "./utils";

const { connect, transactions, KeyPair, keyStores, utils, Account } = require("near-api-js");


  
const ACTIONS: {
    [key: string]: {SendTransactionAction(input: ConnectorInput<unknown>, depay: DepayActions<unknown>): Promise<ConnectorOutput>;};
} = {
    "near:testnet:NFTMint": nftnear,
    "near:mainnet:NFTMint": nftnear,
    "algorand:testnet:NFTMint": nftalgorand,
    "algorand:mainnet:NFTMint": nftalgorand,
    "algorand:testnet:txtest": txtestalgorand,
    "algorand:mainnet:txtest": txtestalgorand,
};

export function SendTransactionAction(input: ConnectorInput<{chain: string; functionDeclaration: string;}>, depay: DepayActions<unknown>) {

    console.log("SendTransactionAction")
    console.log("module: " + input.key);

    // const key = input.fields.chain.concat(':' + input.key.split(':')[1]);

    const key = input.fields.chain.concat(':' + input.fields.functionDeclaration);
    const module = ACTIONS[key];
    
    return module.SendTransactionAction(input, depay);
}