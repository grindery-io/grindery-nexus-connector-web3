import { MessageTypes, SignTypedDataVersion, TypedDataV1, TypedMessage } from "@metamask/eth-sig-util";

import { ethers } from "ethers";
import { callVault } from "../../vaultAgent";

export const TypedDataVersion = SignTypedDataVersion;

export class VaultSigner extends ethers.Signer {
  ethereumAddress = "";

  constructor(provider?: ethers.providers.Provider) {
    super();
    ethers.utils.defineReadOnly(this, "provider", provider || undefined);
  }

  async getAddress(): Promise<string> {
    if (!this.ethereumAddress) {
      const key = await callVault<string>("ethGetAddress");
      this.ethereumAddress = key;
    }
    return Promise.resolve(this.ethereumAddress);
  }

  async signMessage(message: string | ethers.utils.Bytes): Promise<string> {
    return await callVault("ethSignMessage", { message: ethers.utils.hexlify(message) });
  }

  async signTypedData<V extends SignTypedDataVersion, T extends MessageTypes>({
    data,
    version,
  }: {
    data: V extends "V1" ? TypedDataV1 : TypedMessage<T>;
    version: V;
  }): Promise<string> {
    if (data === null || data === undefined) {
      throw new Error("Missing data parameter");
    }
    return await callVault("ethSignTypedData", { data, version });
  }

  async signTransaction(transaction: ethers.utils.Deferrable<ethers.providers.TransactionRequest>): Promise<string> {
    const unsignedTx = await ethers.utils.resolveProperties(transaction);
    return await callVault("ethSignTransaction", { transaction: unsignedTx });
  }

  connect(provider: ethers.providers.Provider): VaultSigner {
    return new VaultSigner(provider);
  }
}

const vaultSigner = new VaultSigner();
export default vaultSigner;
