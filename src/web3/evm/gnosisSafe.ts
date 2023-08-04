import Web3 from "web3";
import { AbiItem } from "web3-utils";
import { ethers } from "ethers";
import mutexify from "mutexify/promise";
import axios from "axios";
import vaultSigner from "./signer";
import { SignTypedDataVersion } from "@metamask/eth-sig-util";
import ABI from "./abi/GnosisSafe.json";
import ERC20 from "./abi/ERC20.json";
import { API_BASE } from "./connector/gnosisSafe/common";

export const execTransactionAbi: AbiItem = ABI.find((x) => x.name === "execTransaction") as AbiItem;

const nonceMutexes: { [contractAddress: string]: () => Promise<() => void> } = {};
const ERC20_TRANSFER = ERC20.find((item) => item.name === "transfer");

export async function encodeExecTransaction({
  web3,
  contractAddress,
  parameters,
  dryRun,
}: {
  web3: Web3;
  contractAddress: string;
  parameters: Record<string, unknown>;
  dryRun: boolean;
}): Promise<string | Record<string, unknown>> {
  const contract = new web3.eth.Contract(ABI as AbiItem[], contractAddress);
  parameters.to = String(parameters.to).trim();
  let nonce = "0" as string | number;
  let threshold = 0;
  let chainId = 1;
  if (!nonceMutexes[contractAddress]) {
    nonceMutexes[contractAddress] = mutexify();
  }
  const releaseLock = await nonceMutexes[contractAddress]();
  try {
    try {
      chainId = await contract.methods.getChainId().call();
      threshold = await contract.methods.getThreshold().call();
      if (threshold > 1) {
        try {
          const nonceResp = await axios.post(
            `${API_BASE}v2/chains/${chainId}/safes/${contractAddress}/multisig-transactions/estimations`,
            { value: "0", operation: 0, to: parameters.to, data: "0x" }
          );
          nonce = nonceResp.data.recommendedNonce;
        } catch (e) {
          console.error("Failed to get nonce from Gnosis Safe: ", e, e.response?.data, parameters);
          throw e;
        }
        console.debug(`[${contractAddress}] Nonce: ${nonce}`);
      } else {
        nonce = await contract.methods.nonce.call().call();
      }
    } catch (e) {
      if (!dryRun) {
        throw e;
      }
    }
    if (typeof nonce === "number") {
      nonce = nonce.toString();
    }
    const params = {
      to: parameters.tokenContractAddress || parameters.to,
      value: parameters.tokenContractAddress ? "0" : String(parameters.value),
      data: parameters.tokenContractAddress
        ? web3.eth.abi.encodeFunctionCall(ERC20_TRANSFER as AbiItem, [
            parameters.to as string,
            web3.utils.numberToHex(parameters.value as number),
          ])
        : "0x",
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
      txHash = await contract.methods.getTransactionHash(...Object.values(params)).call();
    } catch (e) {
      if (!dryRun) {
        throw e;
      }
      txHash = "0x0000000000000000000000000000000000000000";
    }
    if (threshold > 1) {
      const message = { ...params, to: ethers.utils.getAddress(String(params.to)) };

      const signature = await vaultSigner.signTypedData({
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
          safeTxHash: txHash,
          signature,
        };
      }
      try {
        const resp = await axios.post(`${API_BASE}v1/chains/${chainId}/transactions/${contractAddress}/propose`, {
          origin: "Grindery Nexus",
          safeTxHash: txHash,
          signature,
          sender: await vaultSigner.getAddress(),
          ...message,
        });
        return resp.data;
      } catch (e) {
        console.error("Failed to send transaction to Gnosis Safe: ", e, e.response?.data, message);
        throw e;
      }
    }
    const signature = await vaultSigner.signMessage(txHash);
    // https://github.com/safe-global/safe-contracts/blob/c36bcab46578a442862d043e12a83fec41143dec/contracts/GnosisSafe.sol#L293
    return await contract.methods
      .execTransaction(
        ...Object.values({
          ...params,
          nonce:
            signature.slice(0, signature.length - 2) +
            (parseInt(signature.slice(signature.length - 2), 16) + 4).toString(16),
        })
      )
      .encodeABI();
  } finally {
    releaseLock();
  }
}
