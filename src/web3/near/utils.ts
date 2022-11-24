
const { 
    connect, 
    transactions, 
    keyStores, 
    utils, 
    KeyPair, 
} = require("near-api-js");




import * as nearApiJs from 'near-api-js'
import { BrowserLocalStorageKeyStore } from 'near-api-js/lib/key_stores'
import { base_encode, base_decode } from './serialize';
import { hmac, TAccessToken } from "../../jwt";
import nacl, { randomBytes } from 'tweetnacl';
import { checkProperties } from 'ethers/lib/utils';
import { consoleLogger } from '@influxdata/influxdb-client';
const { sha256 } = require('js-sha256');

const fs = require("fs");
const path = require("path");
const userHomeDir = require("os").homedir();
const BN = require('bn.js');

const private_key_tcoratger = "ed25519:TvQJsaDCF65uVGfeAzHkSSUFcpbM127uJ3A7GJLnh1eZuRD2wqjdkYWRJXfbkxa6v5yzPjSiPYQ7nQsdgtebEzE";
const public_key_tcoratger_wallet = "0xB201fDd90b14cc930bEc2c4E9f432bC1CA5Ad7C7";

const private_key_depay = 
"ed25519:4STJ43D4LEL7bbSrp3hP1JiuFLZ8gmjuVa5zafQxGpMJXNknFZ1UzYmUuPiuYPKUxDPNbfrw92JuLHDRQEvu2kLb"

const userToken = "eyJhbGciJiJFUzI1NiJ8.eyJhdWQiOiJ1cm46Z3JpbmRlcnk6YWNjZXNzLXRva2VuOnYxIiwic3ViIjoiZWlwMTU1OjE6MHhCMjAxZkRkOTBiMTRjYzkzMGJFYzJjNEU5ZjQzMmJDMUNBNUFkN0M1IiwiaWF0IjoxNjY3Njk0NDk5LCJpc3MiOiJ1cm46Z3JpbmRlcnk6b3JjaGVzdHJhdG9yIiwiZXhwIjoxNjY3Njk4MDk5fQ.eSuX4Jx4VutnAFvs9kC48G4ccHlAuv8OoDzfKZhcFyFQCMda2LxZV4BbZGstFsT-WMoVpKEIexj8O-hg1jm2ZZ"

const networkId = "testnet";
// const accountId = "depay.tcoratger.testnet";
const accountId = "tcoratger.testnet";

const nodeUrl= "https://rpc.testnet.near.org";
const explorerUrl= "https://explorer.testnet.near.org";
const walletUrl= "https://wallet.testnet.near.org";
const CREDENTIALS_DIR = ".near-credentials";

const credentialsPath = path.join(userHomeDir, CREDENTIALS_DIR);
const keyStore = new keyStores.UnencryptedFileSystemKeyStore(credentialsPath);

const config = {
    keyStore,
    networkId: "testnet",
    nodeUrl: "https://rpc.testnet.near.org",
};

async function main() {

    const near = await connect({ ...config, keyStore });
    const account = await near.account(accountId);  

    // const privateKey = base_encode((await hmac("grindery-web3-address-sub/" + userToken)).subarray(0, 64));
    // let newKeyPair = await KeyPair.fromString('ed25519:' + privateKey);
    // newKeyPair = KeyPair.fromString('ed25519:VMe3QZfvwDAoeipGqKyDJWZSvPS2rHPVu3PYGLU2JR9czmd8qHhfrZrXD3gSWfqzjZxL48DDLiiEjU7EYPtphjZ');


    let newKeyPair = KeyPair.fromRandom('ed25519');

    const newPublicKey = await newKeyPair.getPublicKey();
    // const publickeystr = await newPublicKey.toString();
    // let useraccountId = await utils.PublicKey.fromString(publickeystr).data.hexSlice();
    let useraccountId = ("grindery" + public_key_tcoratger_wallet).toLowerCase();

    console.log("useraccountId", useraccountId);

    let UserAccount = await near.account(useraccountId);

    try {
        await UserAccount.state()
    } catch (e) {
        if (e.type === 'HANDLER_ERROR') {
            console.log("account to be created");
            const creationTransaction = await account.createAccount(useraccountId, newPublicKey, await utils.format.parseNearAmount('1'))
            await keyStore.setKey(networkId, useraccountId, newKeyPair);
            console.log("account created");
        }
    }

    UserAccount = await near.account(useraccountId);

    let amountToUser = 10000000000000;

    await UserAccount.sendMoney(accountId, amountToUser);

    const result = await UserAccount.signAndSendTransaction({
        receiverId: accountId, 
        actions: [
            await transactions.functionCall(
                "set_greeting",
                {greeting: "message test"},
                amountToUser
            )
        ]
    });
}



main()

