import { sansPrefix } from "@onflow/fcl";
import { callVault } from "../../vaultAgent";

// This is freshly minted account done with faucet
// Please, don't deplete it because it's being used for education purposes
// Thanks in advance! 👋

export const createSigner = function ({ keyId, accountAddress }: { keyId: number; accountAddress: string }) {
  return async (account) => {
    // authorization function need to return an account
    return {
      ...account, // bunch of defaults in here, we want to overload some of them though
      tempId: `${accountAddress}-${keyId}`, // tempIds are more of an advanced topic, for 99% of the times where you know the address and keyId you will want it to be a unique string per that address and keyId
      addr: sansPrefix(accountAddress), // the address of the signatory, currently it needs to be without a prefix right now
      keyId: Number(keyId), // this is the keyId for the accounts registered key that will be used to sign, make extra sure this is a number and not a string

      // This is where magic happens! ✨
      signingFunction: async (signable) => {
        return await callVault("flowSignTransaction", { signable });
      },
    };
  };
};
