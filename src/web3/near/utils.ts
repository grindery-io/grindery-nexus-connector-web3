import { getNetworkId } from "../utils";
import { hmac } from "../../jwt";
import { base_encode } from "./serialize";
import nacl from "tweetnacl";
import { base58_to_binary, binary_to_base58 } from "base58-js";

import { connect, keyStores, utils } from "near-api-js";
import crypto from "crypto";



/**
 * It takes an address, and if it's a base58 encoded address, it converts it to a hex encoded address
 * @param {T} address - The address to normalize.
 * @returns The address is being returned.
 */
export function normalizeAddress<T>(address: T): T {
  if (!address) {
    return address;
  }
  if (typeof address !== "string") {
    return address;
  }
  if (/^0x[0-9a-f]+$/i.test(address)) {
    return address.slice(2) as unknown as T;
  }
  const m = /^ed25519:([0-9a-z]+)$/i.exec(address);
  if (!m) {
    return address;
  }
  return base58_to_binary(m[1]).toString("hex");
}

/**
 * It takes a user's name, and returns a keypair that can be used to sign transactions
 * @param {string | undefined} user - The user's username.
 * @returns A new keypair
 */
export async function getUserAccountNear(
  user: string | undefined
): Promise<unknown> {
  const seed = (await hmac("grindery-near-key/" + user)).subarray(0, 32);
  const newkeypairtmp = nacl.sign.keyPair.fromSeed(seed);
  const newKeyPair = new utils.KeyPairEd25519(
    base_encode(newkeypairtmp.secretKey)
  );

  return newKeyPair;
}

/**
 * It connects to the NEAR blockchain and returns the account object for the given accountId
 * @param {string} chain - The name of the chain you want to connect to.
 * @param {string} accountId - The account ID of the account you want to get information
 * about.
 * @returns The account object.
 */
export async function nearGetAccount(
  chain: string,
  accountId: string,
  keyStore: keyStores.KeyStore | undefined
) {
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
  const near = await connect({ ...config, keyStore, headers: {} });
  return await near.account(accountId);
}
/**
 * It takes a transaction hash and a block hash, and returns a receipt ID
 * @param {string} txHash - The transaction hash of the transaction you want to get the receipt for.
 * @param {string} blockHash - The hash of the block that contains the transaction.
 * @returns A receipt ID.
 */
export async function receiptIdFromTx(txHash: string, blockHash: string, salt: number): Promise<string> {
  const saltSize = 8;
  const txHashBinary = base58_to_binary(txHash);
  const blockHashBinary = base58_to_binary(blockHash);
  const saltBinary = new Uint8Array(saltSize);
  // saltBinary.fill(salt);
  saltBinary[0] = salt;
  const mergeArray = new Uint8Array(txHashBinary.length + blockHashBinary.length + saltBinary.length);
  let offset = 0;
  [txHashBinary, blockHashBinary, saltBinary].forEach(item => {
    mergeArray.set(item, offset);
    offset += item.length;
  });
  const hashBuffer = await crypto.subtle.digest("SHA-256", mergeArray);
  return binary_to_base58(new Uint8Array(hashBuffer));
}