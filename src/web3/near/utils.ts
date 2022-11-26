
import {SendTransactionAction} from "../actions"


import { EventEmitter } from "node:events";
import _ from "lodash";
import { ConnectorInput, ConnectorOutput, TriggerBase } from "grindery-nexus-common-utils/dist/connector";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import { backOff } from "exponential-backoff";
import blockingTracer from "../../blockingTracer";
import { hmac, TAccessToken } from "../../jwt";
import { base58_to_binary } from "base58-js";
import { base_encode, base_decode } from './serialize';

const { connect, transactions, KeyPair, keyStores, utils, Account } = require("near-api-js");
const fs = require("fs");
const path = require("path");
const homedir = require("os").homedir();

// const private_key_tcoratger = "ed25519:TvQJsaDCF65uVGfeAzHkSSUFcpbM127uJ3A7GJLnh1eZuRD2wqjdkYWRJXfbkxa6v5yzPjSiPYQ7nQsdgtebEzE";
// const public_key_tcoratger_wallet = "0xB201fDd90b14cc930bEc2c4E9f432bC1CA5Ad7X7";

// const private_key_depay = 
// "ed25519:4STJ43D4LEL7bbSrp3hP1JiuFLZ8gmjuVa5zafQxGpMJXNknFZ1UzYmUuPiuYPKUxDPNbfrw92JuLHDRQEvu2kLb"

// const userToken = "eyJhbGciJiJFUzI1NiJ8.eyJhdWQiOiJ1cm46Z3JpbmRlcnk6YWNjZXNzLXRva2VuOnYxIiwic3ViIjoiZWlwMTU1OjE6MHhCMjAxZkRkOTBiMTRjYzkzMGJFYzJjNEU5ZjQzMmJDMUNBNUFkN0M1IiwiaWF0IjoxNjY3Njk0NDk5LCJpc3MiOiJ1cm46Z3JpbmRlcnk6b3JjaGVzdHJhdG9yIiwiZXhwIjoxNjY3Njk4MDk5fQ.eSuX4Jx4VutnAFvs9kC48G4ccHlAuv8OoDzfKZhcFyFQCMda2LxZV4BbZGstFsT-WMoVpKEIexj8O-hg1jm2ZZ"

// const networkId = "testnet";
// // const accountId = "depay.tcoratger.testnet";
// const accountId = "tcoratger.testnet";

// const nodeUrl= "https://rpc.testnet.near.org";
// const explorerUrl= "https://explorer.testnet.near.org";
// const walletUrl= "https://wallet.testnet.near.org";
// const CREDENTIALS_DIR = ".near-credentials";

// const credentialsPath = path.join(userHomeDir, CREDENTIALS_DIR);
// const keyStore = new keyStores.UnencryptedFileSystemKeyStore(credentialsPath);

// const config = {
//     keyStore,
//     networkId: "testnet",
//     nodeUrl: "https://rpc.testnet.near.org",
// };

async function main() {

    // #################################################################
    // #################################################################
    // #################################################################

    const chain: string = "near:testnet";
    const contractAddress: string =  "nft-example.tcoratger.testnet";
    const functionDeclaration: string = "txntest(uint64 amnt, pay ptxn, uint64 fee) returns (uint64)";
    const parameters: { [key: string]: unknown } = {
        "to": "tcoratger.testnet",
        "title": "My Non Fungible Team Token",
        "description": "The Team Most Certainly Goes :)",
        "media": "https://bafybeiftczwrtyr3k7a2k4vutd3amkwsmaqyhrdzlhvpt33dyjivufqusq.ipfs.dweb.link/goteam-gif.gif"
      };
    
    // #################################################################
    // #################################################################
    // #################################################################

    const CREDENTIALS_DIR = ".near-credentials";
    const credentialsPath = path.join(homedir, CREDENTIALS_DIR);
    const keyStore = new keyStores.UnencryptedFileSystemKeyStore(credentialsPath);
    const networkId = chain.split(':')[1];

    // const config = {
    //     networkId,
    //     keyStore,
    //     nodeUrl: `https://rpc.${networkId}.near.org`,
    //     walletUrl: `https://wallet.${networkId}.near.org`,
    //     helperUrl: `https://helper.${networkId}.near.org`,
    //     explorerUrl: `https://explorer.${networkId}.near.org`,
    // };
    
    
    const public_key_tcoratger_wallet = "0xB201fDd90b14cc930bEc2c4E9f432bC1CA5Ad7C4";

    // const near = await connect({ ...config, keyStore });
    // const account = await near.account(process.env.NEAR_ACCOUNT_ID);  

    const account =  await nearGetAccount(chain, process.env.NEAR_ACCOUNT_ID);

    const newKeyPair = KeyPair.fromRandom('ed25519');
    const newPublicKey = await newKeyPair.getPublicKey();
    const useraccountId = ("grindery" + public_key_tcoratger_wallet).toLowerCase();
    // let UserAccount = await near.account(useraccountId);

    let UserAccount = await nearGetAccount(chain, useraccountId);

    console.log("useraccountId", useraccountId);

    try {
        await UserAccount.state()
    } catch (e) {
        if (e.type === 'HANDLER_ERROR') {
            console.log("account to be created");
            await account.createAccount(useraccountId, newPublicKey, await utils.format.parseNearAmount('1'))
            await keyStore.setKey(networkId, useraccountId, newKeyPair);
            console.log("account created");
        }
    }

    // UserAccount = await near.account(useraccountId);

    UserAccount = await nearGetAccount(chain, useraccountId);

    SendTransactionAction(UserAccount, UserAccount)

    // let amountToUser = 10000000000000;

    // await UserAccount.sendMoney(process.env.NEAR_ACCOUNT_ID, amountToUser);

    // const result = await UserAccount.signAndSendTransaction({
    // receiverId: process.env.NEAR_ACCOUNT_ID, 
    // actions: [
    //     await transactions.functionCall(
    //     "set_greeting",
    //     {greeting: "message test"},
    //     amountToUser
    //     )
    // ]
    // });
    
}

// main()


export async function nearGetAccount(chain: string, accountId: string | undefined) {
    const networkId = await getNetworkId(chain);
    const keyStore = await getKeyStore();
    const config = {
        networkId,
        keyStore,
        nodeUrl: `https://rpc.${networkId}.near.org`,
        walletUrl: `https://wallet.${networkId}.near.org`,
        helperUrl: `https://helper.${networkId}.near.org`,
        explorerUrl: `https://explorer.${networkId}.near.org`,
    };
    const near = await connect({ ...config, keyStore });
    return await near.account(accountId);
}

export async function getNetworkId(chain: string) {
    return chain.split(':')[1];
}

export async function getKeyStore() {
    const CREDENTIALS_DIR = ".near-credentials";
    const credentialsPath = path.join(homedir, CREDENTIALS_DIR);
    return (new keyStores.UnencryptedFileSystemKeyStore(credentialsPath));
}
