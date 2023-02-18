import { ActionOutput, ConnectorInput } from "grindery-nexus-common-utils";
import { AbiItem } from "web3-utils";
import { ethers } from "ethers";
import mutexify from "mutexify/promise";
import axios from "axios";
import { NtaSigner } from "../../signer";
import { SignTypedDataVersion } from "@metamask/eth-sig-util";
import ABI from "./abi.json";
import { getWeb3 } from "../../web3";
import { sanitizeParameters } from "../../../../utils";

export const execTransactionAbi: AbiItem = ABI.find((x) => x.name === "execTransaction") as AbiItem;

const nonceMutexes: { [contractAddress: string]: () => Promise<() => void> } = {};

export async function gnosisSafeSimpleTransfer(input: ConnectorInput<unknown>): Promise<ActionOutput> {
  await sanitizeParameters(input, []);
  const parameters = input.fields as { [key: string]: string };
  const dryRun = parameters.dryRun ?? false;
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
  const contractAddress: string = authResp.data.safe;
  parameters.to = String(parameters.to).trim();
  let nonce = "0" as string | number;
  const chainId = authResp.data.chainId;
  if (!nonceMutexes[contractAddress]) {
    nonceMutexes[contractAddress] = mutexify();
  }
  const { web3, close } = getWeb3(`eip155:${chainId}`);
  const releaseLock = await nonceMutexes[contractAddress]();
  try {
    try {
      const nonceResp = await axios.post(
        `https://safe-client.gnosis.io/v2/chains/${chainId}/safes/${contractAddress}/multisig-transactions/estimations`,
        { value: "0", operation: 0, to: parameters.to, data: "0x" }
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
    const params = [
      parameters.to,
      String(parameters.value),
      "0x",
      0,
      "0",
      "0",
      "0",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      nonce,
    ];
    let txHash: string;
    try {
      const contract = new web3.eth.Contract(ABI as unknown as AbiItem[], contractAddress);
      txHash = await contract.methods.getTransactionHash(...params).call();
    } catch (e) {
      if (!dryRun) {
        throw e;
      }
      txHash = "0x0000000000000000000000000000000000000000";
    }
    const [to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver] = params;
    const message = {
      to,
      value,
      data,
      operation,
      safeTxGas,
      baseGas,
      gasPrice,
      gasToken,
      refundReceiver,
      nonce,
    };
    message.to = ethers.utils.getAddress(String(message.to));
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
