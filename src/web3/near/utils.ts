
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
const { sha256 } = require('js-sha256');

const fs = require("fs");
const path = require("path");
const userHomeDir = require("os").homedir();
const BN = require('bn.js');

const private_key_tcoratger = "ed25519:your_private_key";

const private_key_depay = 
"ed25519:your_private_key"

const userToken = "eyJhbGciJiJFUzI1NiJ8.eyJhdWQiOiJ1cm46Z3JpbmRlcnk6YWNjZXNzLXRva2VuOnYxIiwic3ViIjoiZWlwMTU1OjE6MHhCMjAxZkRkOTBiMTRjYzkzMGJFYzJjNEU5ZjQzMmJDMUNBNUFkN0M1IiwiaWF0IjoxNjY3Njk0NDk5LCJpc3MiOiJ1cm46Z3JpbmRlcnk6b3JjaGVzdHJhdG9yIiwiZXhwIjoxNjY3Njk4MDk5fQ.eSuX4Jx4VutnAFvs9kC48G4ccHlAuv8OoDzfKZhcFyFQCMda2LxZV4BbZGstFsT-WMoVpKEIexj8O-hg1jm2ZZ"

const networkId = "testnet";
// const accountId = "depay.tcoratger.testnet";
const accountId = "your-account-id";

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

    let keyPair = await KeyPair.fromString(private_key_tcoratger);
    const near = await connect({ ...config, keyStore });
    const account = await near.account(accountId);  

    // Step 5: Make a new keyPair for the functioncall key
    const privateKey = base_encode((await hmac("grindery-web3-address-sub/" + userToken)).subarray(0, 64));
    let newKeyPair = await KeyPair.fromString('ed25519:' + privateKey);

    // newKeyPair = await KeyPair.fromString('ed25519:2jzR8ifX6uidDi8qXc9FMmvuJEGmopraC8jZThcrJpiGrMWur2t3wzN5VKtepmZo5CUJUGKojFUn7Y6i3V6dMGoz');
    // newKeyPair = KeyPair.fromRandom('ed25519');


    const newPublicKey = await newKeyPair.getPublicKey();
    const publickeystr = await newPublicKey.toString();
    const useraccountId = await utils.PublicKey.fromString(publickeystr).data.hexSlice();

    // await keyStore.setKey(networkId, useraccountId, newKeyPair)


    // // Setting the methodNames on the contract we want this key to access
    // const methodNames = ['set_greeting']

    // // allowance is how much NEAR this key can spend per transaction (0.25 is default)
    // const allowance = await utils.format.parseNearAmount('0.25')

    // // these are the actions we are going to execute - in this case add a function call access key for access.vitalpointai.testnet
    // const actions = [
    //     //Action 1
    //     await transactions.addKey(
    //       await newPublicKey,
    //       await transactions.functionCallAccessKey(accountId, methodNames, allowance)
    //     ),
    // ]

    // const keysAccount = await account.getAccessKeys();
    // const isKeyUser = keysAccount.find(e => e.public_key === publickeystr);

    console.log("useraccountId", useraccountId);
    

    let isUserAccount = true;

    try {
        await near.connection.provider.query({
            request_type: "view_account",
            account_id: useraccountId,
            finality: "final",
        });
    } catch (e) {
        if (e.type === 'AccountDoesNotExist') {
            isUserAccount = false
            console.log("account to be created");
            const creationTransaction = await account.sendMoney(useraccountId, await utils.format.parseNearAmount('2'))
            console.log("account created");
            console.log("creationTransaction", creationTransaction);
        }
    }

    
    
    await keyStore.setKey(networkId, useraccountId, newKeyPair);
    const UserAccount = await near.account(useraccountId);
    
    let txHash, signedTx;
    [txHash, signedTx] = await UserAccount.signTransaction(accountId, [transactions.deleteAccount(accountId)]);
    const publicKey = await signedTx.transaction.publicKey;

    // console.log("signedTx", signedTx)

    // // ##############################################################
    // // ##############################################################
    // // ##############################################################

    // const testreceiverId = accountId;

    // let testactions = [transactions.deleteAccount(testreceiverId)];
    // const accessKeyInfo = await UserAccount.findAccessKey(testreceiverId, testactions);
    // const { accessKey } = accessKeyInfo;
    // const block = await UserAccount.connection.provider.block({ finality: 'final' });
    // const testblockHash = base_decode(block.header.hash);

    // const num = new BN(1);
    // const tmpBN = new BN(accessKey.nonce);
    // const testnonce = tmpBN.add(num);
    // const testsigner = UserAccount.connection.signer;
    // const testaccountId = UserAccount.accountId;
    // const testnetworkId = UserAccount.connection.networkId;

    // const testpublicKey = await testsigner.getPublicKey(testaccountId, testnetworkId);
    // const transaction = transactions.createTransaction(testreceiverId, publicKey, testpublicKey, testnonce, testactions, testblockHash);

    // console.log("testaccountId", testaccountId)

    // console.log("testpublicKey", testpublicKey.toString());
    // console.log("testsigner", testsigner)


    // // ##############################################################
    // // ##############################################################
    // // ##############################################################


    // const toto = await UserAccount.connection.provider.sendTransaction(signedTx);
    // console.log("toto", toto);

    // await UserAccount.deleteAccount(accountId);
    await UserAccount.sendMoney(useraccountId,  await utils.format.parseNearAmount('0.0000001'));

    // // console.log("useraccountId", await UserAccount.accountExists());

    // console.log("isUserAccount", isUserAccount);    

    // // console.log("newPublicKey", newPublicKey)
    
    



    // if (!isKeyUser) {
    //     // // this signs and sends the transaction
    //     // const addKeyTransaction  = await account.signAndSendTransaction({
    //     //     receiverId: accountId, 
    //     //     actions: actions,
    //     // })

    //     await account.createAccount(useraccountId, newPublicKey, await utils.format.parseNearAmount('1'));
    // }

    // // Use the key
    // // Step 1:  get the keypair from the account's localstorage private key we set earlier
    // let userkeyPair = await keyStore.getKey(networkId, useraccountId)
    // // let keyPair = KeyPair.fromString(private_key)

    // // Step 2:  load up an inMemorySigner using the keyPair for the account
    // let usersigner = await InMemorySigner.fromKeyPair(networkId, accountId, userkeyPair)

    // Step 3:  create a connection to the network using the signer's keystore and default config for testnet
    // const usernear = await connect({ ...config, keyStore });
    // const usernear = await connect({ ...config, deps: { keyStore: usersigner.keyStore } });

    const usernear = await connect({ ...config, keyStore });
    
    let useraccount = await usernear.account(useraccountId);

    const actionTransaction = [
        await transactions.functionCall(
            "set_greeting",
            {greeting: "test"},
            10000000000000,
        )
    ]
}

async function newAccount() {

    const private_key_user = "ed25519:your_private_key";
    const useraccountId = "your-user-id";

    // const private_key_user = "ed25519:2jzR8ifX6uidDi8qXc9FMmvuJEGmopraC8jZThcrJpiGrMWur2t3wzN5VKtepmZo5CUJUGKojFUn7Y6i3V6dMGou";
    // const useraccountId = "e661c12ff4e693f0268188e6488aa19382e72620e3b66d894cc3c7dc9cc4683c";

    let keyPair = await KeyPair.fromString(private_key_user);
    const near = await connect({ ...config,  keyStore });

    // Step 4:  get the account object of the currentAccount.  At this point, we should have full control over the account.
    const account = await near.account(useraccountId);      

    const keyPair1 = new utils.key_pair.KeyPairEd25519('5JueXZhEEVqGVT5powZ5twyPP8wrap2K7RdAYGGdjBwiBdd7Hh6aQxMP1u3Ma9Yanq1nEv32EW7u8kUJsZ6f315C');

    console.log("keyPair1", keyPair1);
    
    let actions = [transactions.transfer(await utils.format.parseNearAmount('0.0000001'))]
    
    let txHash, signedTx;
    [txHash, signedTx] = await account.signTransaction(accountId, actions);
    const publicKey = await signedTx.transaction.publicKey;

    await account.connection.provider.sendTransaction(signedTx);

}





main()

