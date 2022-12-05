import _ from "lodash";
import { getNetworkId } from "../utils";
import * as ed25519 from "ed25519";
import { hmac, TAccessToken } from "../../jwt";
import { Buffer } from 'buffer';
const Base58 = require("base-58")
import * as ed from '@noble/ed25519';
const textEncoding = require('text-encoding');
import { base_encode, base_decode } from './serialize';


var crypto = require('crypto');

const { connect, keyStores, nearConnection, transactions, utils, KeyPair, KeyPairEd25519 } = require("near-api-js");
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

    console.log("toto");

    const PUBLIC_KEY_USER="0xB201fDd90b14cc930bEc2c4E9f432bC1CA5Ad0U1"
    const chain = "near:testnet";
    const nearaccountId = "tcoratger.testnet"
    
    // const account = await nearGetAccount(chain, nearaccountId);
    // const useraccountId = ("grindery" + PUBLIC_KEY_USER).toLowerCase();
    // let useraccount = await nearGetAccount(chain, useraccountId);

    // console.log("useraccountId", useraccountId);

    // try {
    //     await useraccount.state()
    // } catch (e) {
    //     if (e.type === 'HANDLER_ERROR') {
    //     console.log("new account to be created");
    //     const keyStore = await getKeyStore();
    //     const networkId = await getNetworkId(chain);
    //     const newKeyPair = KeyPair.fromRandom('ed25519');


    //     // const privateKey= base_encode((await hmac("grindery-web3-address-sub/" + PUBLIC_KEY_USER)).subarray(0, 64));
    //     // let newKeyPair = await KeyPair.fromString('ed25519:' + privateKeyTmp);



    //     const newPublicKey = await newKeyPair.getPublicKey();
    //     await account.createAccount(useraccountId, newPublicKey, await utils.format.parseNearAmount('1'))
    //     await keyStore.setKey(networkId, useraccountId, newKeyPair);
    //     console.log("new account created with userID ", useraccountId);
    //     }
    // }

    // await useraccount.sendMoney(useraccountId, 10000000000000);

    

    
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

export async function getKeyStore() {
    const CREDENTIALS_DIR = ".near-credentials";
    const credentialsPath = path.join(homedir, CREDENTIALS_DIR);
    return (new keyStores.UnencryptedFileSystemKeyStore(credentialsPath));
}
