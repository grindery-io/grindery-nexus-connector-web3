
const { 
    connect, 
    transactions, 
    keyStores, 
    utils, 
    KeyPair, 
    parseNearAmount, 
    InMemorySigner,
    Contract,
    createAccount,
    Account,
    providers,
    AccessKeyView,
    Transaction,
    createTransaction,
    fullAccessKey,
    PublicKey,
    KeyPairEd25519 } = require("near-api-js");


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

const networkId = "testnet";
// const accountId = "depay.tcoratger.testnet";
const accountId = "tcoratger.testnet";


async function main() {
    // My personal account
    let keyPair = await KeyPair.fromString(private_key_tcoratger);
    const near = await connect({ ...config, keyStore });
    const account = await near.account(accountId);  

    // The private key I want to create for the new account with the userToken from my app
    // const privateKey = base_encode((await hmac("grindery-web3-address-sub/" + userToken)).subarray(0, 64));
    // let newKeyPair = await KeyPair.fromString('ed25519:' + privateKey);

    let newKeyPair = KeyPair.fromString('ed25519:2jzR8ifX6uidDi8qXc9FMmvuJEGmopraC8jZThcrJpiGrMWur2t3wzN5VKtepmZo5CUJUGKojFUn7Y6i3V6dMGoa');

    // The associate new public key
    const newPublicKey = await newKeyPair.getPublicKey();
    const publickeystr = await newPublicKey.toString();

    // The new accountid
    const useraccountId = await utils.PublicKey.fromString(publickeystr).data.hexSlice();

    console.log("useraccountId", useraccountId);

    // Implicit creation of the new account from my personal account
    try {
        await near.connection.provider.query({
            request_type: "view_account",
            account_id: useraccountId,
            finality: "final",
        });
    } catch (e) {
        if (e.type === 'AccountDoesNotExist') {
            console.log("account to be created");
            const creationTransaction = await account.sendMoney(useraccountId, await utils.format.parseNearAmount('2'))
            console.log("account created");
            console.log("creationTransaction", creationTransaction);
        }
    }

    // Add the new account to the key store
    await keyStore.setKey(networkId, useraccountId, newKeyPair);

    // Connect to my new account where I have funds (2 previously deposited)
    const UserAccount = await near.account(useraccountId);

    // Trying to send money from this New account to my personal account
    await UserAccount.sendMoney(useraccountId,  await utils.format.parseNearAmount('0.0000001'));

}

main();


