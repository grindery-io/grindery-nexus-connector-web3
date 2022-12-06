import _ from "lodash";
import { getNetworkId } from "../utils";
import { hmac, TAccessToken } from "../../jwt";
import { Buffer } from 'buffer';
import { base_encode, base_decode } from './serialize';
import nacl, { randomBytes } from 'tweetnacl';

var crypto = require('crypto');

const { connect, keyStores, nearConnection, transactions, utils, KeyPair, KeyPairEd25519 } = require("near-api-js");
const path = require("path");
const homedir = require("os").homedir();

async function main() {

    // const PUBLIC_KEY_USER="0xB201fDd90b14cc930bEc2c4E9f432bC1CA5Ad0W1"
    const PUBLIC_KEY_USER="0xB201fDd9yb14dc930bEc2c4E9f432bC1CA5Ad0f1"
    const chain = "near:testnet";
    const nearaccountId = "tcoratger.testnet"

    const keyStore = await getKeyStore();
    
    const account = await nearGetAccount(chain, nearaccountId, keyStore);
    const useraccountId = ("grindery" + PUBLIC_KEY_USER).toLowerCase();
    let useraccount = await nearGetAccount(chain, useraccountId, keyStore);

    console.log("useraccountId", useraccountId);

    // const seed = (await hmac("grindery-near-key/" + PUBLIC_KEY_USER)).subarray(0, 32);
    // const newkeypair = nacl.sign.keyPair.fromSeed(seed);
    // const userkeypair = new utils.KeyPairEd25519(base_encode(newkeypair.secretKey));

    // let newKeyPair = await KeyPair.fromString('ed25519:' + privateKey);

    // console.log("newKeyPair", newKeyPair);


    try {
        await useraccount.state()
    } catch (e) {
        if (e.type === 'AccountDoesNotExist') {
        console.log("new account to be created");
        const keyStore = await getKeyStore();
        const networkId = await getNetworkId(chain);


        // const newKeyPair = KeyPair.fromRandom('ed25519');


        // const privateKey= base_encode((await hmac("grindery-web3-address-sub/" + PUBLIC_KEY_USER)).subarray(0, 64));
        // let newKeyPair = await KeyPair.fromString('ed25519:' + privateKeyTmp);

        const seed = (await hmac("grindery-near-key/" + PUBLIC_KEY_USER)).subarray(0, 32);
        const newkeypairtmp = nacl.sign.keyPair.fromSeed(seed);
        const newKeyPair = new utils.KeyPairEd25519(base_encode(newkeypairtmp.secretKey));

        const newPublicKey = await newKeyPair.getPublicKey();
        await account.createAccount(useraccountId, newPublicKey, await utils.format.parseNearAmount('1'));


        await keyStore.setKey(networkId, useraccountId, newKeyPair);
        console.log("new account created with userID ", useraccountId);
        }
    }

    await useraccount.sendMoney(useraccountId, 10000000000000);

    console.log("fin function")

    
}

// main()

export async function getUserAccountNear(user: string | undefined): Promise<any> {

    const seed = (await hmac("grindery-near-key/" + user)).subarray(0, 32);
    const newkeypairtmp = nacl.sign.keyPair.fromSeed(seed);
    const newKeyPair = new utils.KeyPairEd25519(base_encode(newkeypairtmp.secretKey));

    return newKeyPair;

}


/**
 * It connects to the NEAR blockchain and returns the account object for the given accountId
 * @param {string} chain - The name of the chain you want to connect to.
 * @param {string | undefined} accountId - The account ID of the account you want to get information
 * about.
 * @returns The account object.
 */
export async function nearGetAccount(chain: string, accountId: string | undefined, keyStore: any) {
    const networkId = await getNetworkId(chain);
    // const keyStore = await getKeyStore();
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

/**
 * It returns a keystore that is used to store the private key of the account
 * @returns A keystore object.
 */
export async function getKeyStore() {
    const CREDENTIALS_DIR = ".near-credentials";
    const credentialsPath = path.join(homedir, CREDENTIALS_DIR);
    return (new keyStores.UnencryptedFileSystemKeyStore(credentialsPath));
}
