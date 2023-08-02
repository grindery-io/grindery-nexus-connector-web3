import { ActionOutput, ConnectorInput } from "grindery-nexus-common-utils";
import { AbiItem } from "web3-utils";
import { ethers } from "ethers";
import mutexify from "mutexify/promise";
import axios from "axios";
import { NtaSigner } from "../../signer";
import { SignTypedDataVersion } from "@metamask/eth-sig-util";
import ABI from "../../abi/GnosisSafe.json";
import ERC20 from "../../abi/ERC20.json";
import { getWeb3 } from "../../web3";
import { sanitizeParameters } from "../../../../utils";
import AbiCoder from "web3-eth-abi";
import Web3 from "web3";

const ERC20_TRANSFER = ERC20.find((item) => item.name === "transfer");
const nonceMutexes: { [contractAddress: string]: () => Promise<() => void> } = {};

/**
 * Sanitizes the input fields in the provided ConnectorInput object.
 *
 * @param input - The ConnectorInput object containing the input fields to sanitize.
 * @throws {Error} Throws an error if authentication is required but not provided
 */
export async function sanitizeInput(input: ConnectorInput<unknown>) {
  const parameters = input.fields as { [key: string]: string };
  const m = /^eip155:(\d+)$/.exec(parameters._grinderyChain || "");
  if (m) {
    parameters.chainId = m[1];
  }
  delete parameters._grinderyChain;
  parameters.contractAddress = parameters.contractAddress || parameters._grinderyContractAddress;
  if (!["chainId", "contractAddress"].every((x) => parameters[x])) {
    if (!input.authentication) {
      throw new Error("Authentication required");
    }
    const authResp = await axios.post(
      (process.env.CREDENTIAL_MANAGER_REQUEST_PREFIX || "").replace("$CDS_NAME", "safe") +
        "grindery-nexus-orchestrator:3000/webhook/web3/callSmartContract/echo",
      { safe: "{{ auth.safe }}", chainId: "{{ auth.chainId }}" },
      {
        headers: {
          Authorization: `Bearer ${input.authentication}`,
          "Content-Type": "application/json",
          "x-grindery-template-scope": "all",
        },
      }
    );
    parameters.chainId = authResp.data.chainId;
    parameters.contractAddress = authResp.data.safe;
  }
  parameters.chain = `eip155:${parameters.chainId}`;
  await sanitizeParameters(input, []);
}

async function proposeTransaction(input: ConnectorInput<unknown>): Promise<ActionOutput> {
  const parameters = input.fields as { [key: string]: string };
  const dryRun = parameters.dryRun ?? false;
  const contractAddress: string = parameters.contractAddress;
  parameters.to = ethers.utils.getAddress(String(parameters.to).trim());
  let nonce = "0" as string | number;
  if (!nonceMutexes[contractAddress]) {
    nonceMutexes[contractAddress] = mutexify();
  }
  const chainId = Number(parameters.chainId);
  const { web3, close } = getWeb3(parameters.chain);
  const releaseLock = await nonceMutexes[contractAddress]();
  try {
    try {
      const nonceResp = await axios.post(
        `https://safe-client.gnosis.io/v2/chains/${chainId}/safes/${contractAddress}/multisig-transactions/estimations`,
        { value: "0", operation: 0, to: parameters.to, data: parameters.data }
      );
      nonce = nonceResp.data.recommendedNonce;
    } catch (e) {
      console.error("Failed to get nonce from Gnosis Safe: ", e, e.response?.data, parameters);
      if (!dryRun) {
        throw e;
      }
    }
    console.debug(`[${contractAddress}] Nonce: ${nonce}`);
    if (typeof nonce === "number") {
      nonce = nonce.toString();
    }

    const params = {
      to: parameters.to,
      value: String(parameters.value),
      data: parameters.data,
      operation: 0,
      safeTxGas: "0",
      baseGas: "0",
      gasPrice: "0",
      gasToken: "0x0000000000000000000000000000000000000000",
      refundReceiver: "0x0000000000000000000000000000000000000000",
      nonce,
    };

    let txHash: string;
    try {
      const contract = new web3.eth.Contract(ABI as AbiItem[], contractAddress);
      txHash = await contract.methods.getTransactionHash(...Object.values(params)).call();
    } catch (e) {
      if (!dryRun) {
        throw e;
      }
      txHash = "0x0000000000000000000000000000000000000000";
    }
    const message = { ...params, to: ethers.utils.getAddress(String(params.to)) };
    const signature = await NtaSigner.signTypedData({
      data: {
        types: {
          EIP712Domain: [
            {
              type: "uint256",
              name: "chainId",
            },
            {
              type: "address",
              name: "verifyingContract",
            },
          ],
          SafeTx: [
            { type: "address", name: "to" },
            { type: "uint256", name: "value" },
            { type: "bytes", name: "data" },
            { type: "uint8", name: "operation" },
            { type: "uint256", name: "safeTxGas" },
            { type: "uint256", name: "baseGas" },
            { type: "uint256", name: "gasPrice" },
            { type: "address", name: "gasToken" },
            { type: "address", name: "refundReceiver" },
            { type: "uint256", name: "nonce" },
          ],
        },
        primaryType: "SafeTx",
        domain: {
          chainId,
          verifyingContract: contractAddress,
        },
        message,
      },
      version: SignTypedDataVersion.V4,
    });
    if (dryRun) {
      return {
        payload: {
          safeTxHash: txHash,
          signature,
        },
      };
    }
    try {
      const resp = await axios.post(
        `https://safe-client.gnosis.io/v1/chains/${chainId}/transactions/${contractAddress}/propose`,
        {
          origin: "Grindery Flow",
          safeTxHash: txHash,
          signature,
          sender: await NtaSigner.getAddress(),
          ...message,
        }
      );
      return { payload: resp.data };
    } catch (e) {
      console.error("Failed to send transaction to Gnosis Safe: ", e, e.response?.data, message);
      throw e;
    }
  } finally {
    releaseLock();
    close();
  }
}

export async function gnosisSafeSimpleTransfer(input: ConnectorInput<unknown>): Promise<ActionOutput> {
  await sanitizeInput(input);
  const parameters = input.fields as { [key: string]: string };
  parameters.data = "0x";
  return await proposeTransaction(input);
}

export async function gnosisSafeSimpleTransferToken(input: ConnectorInput<unknown>): Promise<ActionOutput> {
  await sanitizeInput(input);
  const parameters = input.fields as { [key: string]: unknown };
  parameters.data = AbiCoder.encodeFunctionCall(ERC20_TRANSFER as AbiItem, [
    parameters.to as string,
    Web3.utils.numberToHex(parameters.value as number),
  ]);
  parameters.value = "0";
  parameters.to = parameters.tokenContractAddress;
  return await proposeTransaction(input);
}
