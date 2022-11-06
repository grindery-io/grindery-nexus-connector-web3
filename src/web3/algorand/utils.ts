import { hmac, TAccessToken } from "../../jwt";
import nacl, { randomBytes } from 'tweetnacl';
import * as jose from "jose";
import Web3 from "web3";
import { AbiItem, AbiInput, AbiOutput, StateMutabilityType, AbiType } from "web3-utils";
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

export function parseFunctionDeclarationAlgorand(functionDeclaration: string): algosdk.ABIMethod {

    const m = /^\s*(function +)?([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*(.*)$/.exec(functionDeclaration);
    if (!m) {
        throw new Error("Invalid function declaration");
    }
    const name = m[2];
    const args:algosdk.ABIMethodArgParams[] = m[3].split(",").map((p) => {
        const parts = p.trim().split(/\s+/);
        if (parts.length < 2) {
          throw new Error("Invalid function declaration: Invalid parameter " + p);
        }
        return {
          type: parts[0],
          name: parts[parts.length - 1],
        };
    });
    const returnMatch = /\breturns\s+\(([^)]+)\)/.exec(m[4]);
    const returns = returnMatch
        ? returnMatch[1].split(",").map((p, index) => {
            const parts = p.trim().split(/\s+/);
            return {
            type: parts[0],
            name: parts[1] || `return${index}`,
            };
        })
        : [];

    // // let MethodParams:algosdk.ABIMethodParams= {name:name, args:args, returns:returns[0]};


    // // const result = new algosdk.ABIMethod(MethodParams);

    // console.log("returnMatch", returnMatch);

    return new algosdk.ABIMethod({name:name, args:args, returns:returns[0]});

}
