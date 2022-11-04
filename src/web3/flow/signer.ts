import { sansPrefix, withPrefix } from "@onflow/fcl";
import { createHash } from "crypto";
import elliptic from "elliptic";

const curve = new elliptic.ec("secp256k1");

const hashMessageHex = (msgHex) => {
  const sha = createHash("sha256");
  sha.update(Buffer.from(msgHex, "hex"));
  return sha.digest();
};

const signWithKey = (privateKey, msgHex) => {
  const key = curve.keyFromPrivate(Buffer.from(privateKey, "hex"));
  const sig = key.sign(hashMessageHex(msgHex));
  const n = 32;
  const r = sig.r.toArrayLike(Buffer, "be", n);
  const s = sig.s.toArrayLike(Buffer, "be", n);
  return Buffer.concat([r, s]).toString("hex");
};

export function publicKeyFromPrivateKey(privateKey: string): string {
  return curve.keyFromPrivate(Buffer.from(privateKey, "hex")).getPublic("hex").slice(2);
}

// This is freshly minted account done with faucet
// Please, don't deplete it because it's being used for education purposes
// Thanks in advance! 👋

export const createSigner = function ({
  keyId,
  accountAddress,
  pkey,
}: {
  keyId: number;
  accountAddress: string;
  pkey: string;
}) {
  return async (account) => {
    // authorization function need to return an account
    return {
      ...account, // bunch of defaults in here, we want to overload some of them though
      tempId: `${accountAddress}-${keyId}`, // tempIds are more of an advanced topic, for 99% of the times where you know the address and keyId you will want it to be a unique string per that address and keyId
      addr: sansPrefix(accountAddress), // the address of the signatory, currently it needs to be without a prefix right now
      keyId: Number(keyId), // this is the keyId for the accounts registered key that will be used to sign, make extra sure this is a number and not a string

      // This is where magic happens! ✨
      signingFunction: async (signable) => {
        // Singing functions are passed a signable and need to return a composite signature
        // signable.message is a hex string of what needs to be signed.
        const signature = signWithKey(pkey, signable.message);
        return {
          addr: withPrefix(accountAddress), // needs to be the same as the account.addr but this time with a prefix, eventually they will both be with a prefix
          keyId: Number(keyId), // needs to be the same as account.keyId, once again make sure its a number and not a string
          signature, // this needs to be a hex string of the signature, where signable.message is the hex value that needs to be signed
        };
      },
    };
  };
};
