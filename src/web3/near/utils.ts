import { getNetworkId } from "../utils";
import { hmac } from "../../jwt";
import { base_encode } from "./serialize";
import nacl from "tweetnacl";

import { connect, keyStores, utils } from "near-api-js";

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
