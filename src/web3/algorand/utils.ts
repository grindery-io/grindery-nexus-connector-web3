import { hmac, TAccessToken } from "../../jwt";
import nacl, { randomBytes } from 'tweetnacl';
import * as jose from "jose";
import Web3 from "web3";
import { AbiItem } from "web3-utils";
import { BlockTransactionObject } from "web3-eth";
import algosdk from "algosdk";


export async function getUserAccountAlgorand(user: TAccessToken): Promise<algosdk.Account> {

    const lengthSecretKey = nacl.box.secretKeyLength;
    const seed = (await hmac("grindery-web3-address-sub/" + user.sub)).subarray(0, lengthSecretKey);
    const keypair = nacl.sign.keyPair.fromSeed(seed);
    const encodedPk = algosdk.encodeAddress(keypair.publicKey);

    // console.log("seed", seed);
    // console.log("keypair", keypair);
    // console.log("{ addr: encodedPk, sk: keys.secretKey }", { addr: encodedPk, sk: keypair.secretKey })

    return { addr: encodedPk, sk: keypair.secretKey };

}

