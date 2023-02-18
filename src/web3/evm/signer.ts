import { MessageTypes, SignTypedDataVersion, TypedDataV1, TypedMessage } from "@metamask/eth-sig-util";

import { ethers } from "ethers";
import { callVault } from "../../vaultAgent";

export const TypedDataVersion = SignTypedDataVersion;

export class VaultSigner extends ethers.Signer {
  ethereumAddress = "";

  constructor(provider?: ethers.providers.Provider, private prefix = "eth") {
    super();
    ethers.utils.defineReadOnly(this, "provider", provider || undefined);
  }

  async getAddress(): Promise<string> {
    if (!this.ethereumAddress) {
      const key = await callVault<string>(`${this.prefix}GetAddress`);
      this.ethereumAddress = key;
    }
    return Promise.resolve(this.ethereumAddress);
  }

  async signMessage(message: string | ethers.utils.Bytes): Promise<string> {
    return await callVault(`${this.prefix}SignMessage`, { message: ethers.utils.hexlify(message) });
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
    return await callVault(`${this.prefix}SignTypedData`, { data, version });
  }

  async signTransaction(transaction: ethers.utils.Deferrable<ethers.providers.TransactionRequest>): Promise<string> {
    const unsignedTx = await ethers.utils.resolveProperties(transaction);
    return await callVault(`${this.prefix}SignTransaction`, { transaction: unsignedTx });
  }

  connect(provider: ethers.providers.Provider): VaultSigner {
    return new VaultSigner(provider);
  }
}

export const NtaSigner = new VaultSigner(undefined, "ethNta");

const vaultSigner = new VaultSigner();
export default vaultSigner;
