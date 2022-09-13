import Web3 from "web3";
import { AbiItem } from "web3-utils";
import { ethers } from "ethers";
import { joinSignature } from "@ethersproject/bytes";
import { TypedDataUtils } from "ethers-eip712";
import mutexify from "mutexify/promise";
import axios from "axios";

const ABI = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "owner",
        type: "address",
      },
    ],
    name: "AddedOwner",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "approvedHash",
        type: "bytes32",
      },
      { indexed: true, internalType: "address", name: "owner", type: "address" },
    ],
    name: "ApproveHash",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "handler",
        type: "address",
      },
    ],
    name: "ChangedFallbackHandler",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "guard",
        type: "address",
      },
    ],
    name: "ChangedGuard",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "threshold",
        type: "uint256",
      },
    ],
    name: "ChangedThreshold",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "module",
        type: "address",
      },
    ],
    name: "DisabledModule",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "module",
        type: "address",
      },
    ],
    name: "EnabledModule",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "bytes32",
        name: "txHash",
        type: "bytes32",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "payment",
        type: "uint256",
      },
    ],
    name: "ExecutionFailure",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "module",
        type: "address",
      },
    ],
    name: "ExecutionFromModuleFailure",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "module",
        type: "address",
      },
    ],
    name: "ExecutionFromModuleSuccess",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "bytes32",
        name: "txHash",
        type: "bytes32",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "payment",
        type: "uint256",
      },
    ],
    name: "ExecutionSuccess",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "owner",
        type: "address",
      },
    ],
    name: "RemovedOwner",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "module",
        type: "address",
      },
      { indexed: false, internalType: "address", name: "to", type: "address" },
      {
        indexed: false,
        internalType: "uint256",
        name: "value",
        type: "uint256",
      },
      { indexed: false, internalType: "bytes", name: "data", type: "bytes" },
      {
        indexed: false,
        internalType: "enum Enum.Operation",
        name: "operation",
        type: "uint8",
      },
    ],
    name: "SafeModuleTransaction",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: false, internalType: "address", name: "to", type: "address" },
      {
        indexed: false,
        internalType: "uint256",
        name: "value",
        type: "uint256",
      },
      { indexed: false, internalType: "bytes", name: "data", type: "bytes" },
      {
        indexed: false,
        internalType: "enum Enum.Operation",
        name: "operation",
        type: "uint8",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "safeTxGas",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "baseGas",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "gasPrice",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "address",
        name: "gasToken",
        type: "address",
      },
      {
        indexed: false,
        internalType: "address payable",
        name: "refundReceiver",
        type: "address",
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "signatures",
        type: "bytes",
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "additionalInfo",
        type: "bytes",
      },
    ],
    name: "SafeMultiSigTransaction",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "value",
        type: "uint256",
      },
    ],
    name: "SafeReceived",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "initiator",
        type: "address",
      },
      {
        indexed: false,
        internalType: "address[]",
        name: "owners",
        type: "address[]",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "threshold",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "address",
        name: "initializer",
        type: "address",
      },
      {
        indexed: false,
        internalType: "address",
        name: "fallbackHandler",
        type: "address",
      },
    ],
    name: "SafeSetup",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "msgHash",
        type: "bytes32",
      },
    ],
    name: "SignMsg",
    type: "event",
  },
  { stateMutability: "nonpayable", type: "fallback" },
  {
    inputs: [],
    name: "VERSION",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "owner", type: "address" },
      { internalType: "uint256", name: "_threshold", type: "uint256" },
    ],
    name: "addOwnerWithThreshold",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "hashToApprove", type: "bytes32" }],
    name: "approveHash",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "", type: "address" },
      { internalType: "bytes32", name: "", type: "bytes32" },
    ],
    name: "approvedHashes",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_threshold", type: "uint256" }],
    name: "changeThreshold",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "bytes32", name: "dataHash", type: "bytes32" },
      { internalType: "bytes", name: "data", type: "bytes" },
      { internalType: "bytes", name: "signatures", type: "bytes" },
      { internalType: "uint256", name: "requiredSignatures", type: "uint256" },
    ],
    name: "checkNSignatures",
    outputs: [],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "bytes32", name: "dataHash", type: "bytes32" },
      { internalType: "bytes", name: "data", type: "bytes" },
      { internalType: "bytes", name: "signatures", type: "bytes" },
    ],
    name: "checkSignatures",
    outputs: [],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "prevModule", type: "address" },
      { internalType: "address", name: "module", type: "address" },
    ],
    name: "disableModule",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "domainSeparator",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "module", type: "address" }],
    name: "enableModule",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "value", type: "uint256" },
      { internalType: "bytes", name: "data", type: "bytes" },
      { internalType: "enum Enum.Operation", name: "operation", type: "uint8" },
      { internalType: "uint256", name: "safeTxGas", type: "uint256" },
      { internalType: "uint256", name: "baseGas", type: "uint256" },
      { internalType: "uint256", name: "gasPrice", type: "uint256" },
      { internalType: "address", name: "gasToken", type: "address" },
      { internalType: "address", name: "refundReceiver", type: "address" },
      { internalType: "uint256", name: "_nonce", type: "uint256" },
    ],
    name: "encodeTransactionData",
    outputs: [{ internalType: "bytes", name: "", type: "bytes" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "value", type: "uint256" },
      { internalType: "bytes", name: "data", type: "bytes" },
      { internalType: "enum Enum.Operation", name: "operation", type: "uint8" },
      { internalType: "uint256", name: "safeTxGas", type: "uint256" },
      { internalType: "uint256", name: "baseGas", type: "uint256" },
      { internalType: "uint256", name: "gasPrice", type: "uint256" },
      { internalType: "address", name: "gasToken", type: "address" },
      {
        internalType: "address payable",
        name: "refundReceiver",
        type: "address",
      },
      { internalType: "bytes", name: "signatures", type: "bytes" },
    ],
    name: "execTransaction",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "value", type: "uint256" },
      { internalType: "bytes", name: "data", type: "bytes" },
      { internalType: "enum Enum.Operation", name: "operation", type: "uint8" },
    ],
    name: "execTransactionFromModule",
    outputs: [{ internalType: "bool", name: "success", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "value", type: "uint256" },
      { internalType: "bytes", name: "data", type: "bytes" },
      { internalType: "enum Enum.Operation", name: "operation", type: "uint8" },
    ],
    name: "execTransactionFromModuleReturnData",
    outputs: [
      { internalType: "bool", name: "success", type: "bool" },
      { internalType: "bytes", name: "returnData", type: "bytes" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "getChainId",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "start", type: "address" },
      { internalType: "uint256", name: "pageSize", type: "uint256" },
    ],
    name: "getModulesPaginated",
    outputs: [
      { internalType: "address[]", name: "array", type: "address[]" },
      { internalType: "address", name: "next", type: "address" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getOwners",
    outputs: [{ internalType: "address[]", name: "", type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "offset", type: "uint256" },
      { internalType: "uint256", name: "length", type: "uint256" },
    ],
    name: "getStorageAt",
    outputs: [{ internalType: "bytes", name: "", type: "bytes" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getThreshold",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "value", type: "uint256" },
      { internalType: "bytes", name: "data", type: "bytes" },
      { internalType: "enum Enum.Operation", name: "operation", type: "uint8" },
      { internalType: "uint256", name: "safeTxGas", type: "uint256" },
      { internalType: "uint256", name: "baseGas", type: "uint256" },
      { internalType: "uint256", name: "gasPrice", type: "uint256" },
      { internalType: "address", name: "gasToken", type: "address" },
      { internalType: "address", name: "refundReceiver", type: "address" },
      { internalType: "uint256", name: "_nonce", type: "uint256" },
    ],
    name: "getTransactionHash",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "module", type: "address" }],
    name: "isModuleEnabled",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "owner", type: "address" }],
    name: "isOwner",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "nonce",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "prevOwner", type: "address" },
      { internalType: "address", name: "owner", type: "address" },
      { internalType: "uint256", name: "_threshold", type: "uint256" },
    ],
    name: "removeOwner",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "value", type: "uint256" },
      { internalType: "bytes", name: "data", type: "bytes" },
      { internalType: "enum Enum.Operation", name: "operation", type: "uint8" },
    ],
    name: "requiredTxGas",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "handler", type: "address" }],
    name: "setFallbackHandler",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "guard", type: "address" }],
    name: "setGuard",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address[]", name: "_owners", type: "address[]" },
      { internalType: "uint256", name: "_threshold", type: "uint256" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "bytes", name: "data", type: "bytes" },
      { internalType: "address", name: "fallbackHandler", type: "address" },
      { internalType: "address", name: "paymentToken", type: "address" },
      { internalType: "uint256", name: "payment", type: "uint256" },
      {
        internalType: "address payable",
        name: "paymentReceiver",
        type: "address",
      },
    ],
    name: "setup",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    name: "signedMessages",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "targetContract", type: "address" },
      { internalType: "bytes", name: "calldataPayload", type: "bytes" },
    ],
    name: "simulateAndRevert",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "prevOwner", type: "address" },
      { internalType: "address", name: "oldOwner", type: "address" },
      { internalType: "address", name: "newOwner", type: "address" },
    ],
    name: "swapOwner",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  { stateMutability: "payable", type: "receive" },
];

const ERC20_TRANSFER = {
  inputs: [
    { internalType: "address", name: "recipient", type: "address" },
    { internalType: "uint256", name: "amount", type: "uint256" },
  ],
  name: "transfer",
  outputs: [{ internalType: "bool", name: "", type: "bool" }],
  stateMutability: "nonpayable",
  type: "function",
};

export const execTransactionAbi: AbiItem = ABI.find((x) => x.name === "execTransaction") as AbiItem;

const nonceMutexes: { [contractAddress: string]: () => Promise<() => void> } = {};

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contract = new web3.eth.Contract(ABI as any, contractAddress);
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
        const nonceResp = await axios.post(
          `https://safe-client.gnosis.io/v2/chains/${chainId}/safes/${contractAddress}/multisig-transactions/estimations`,
          { value: "0", operation: 0, to: parameters.to, data: "0x" }
        );
        nonce = nonceResp.data.recommendedNonce;
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
    const params = [
      parameters.tokenContractAddress || parameters.to,
      parameters.tokenContractAddress ? "0" : String(parameters.value),
      parameters.tokenContractAddress
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          web3.eth.abi.encodeFunctionCall(ERC20_TRANSFER as any, [
            parameters.to as string,
            web3.utils.numberToHex(parameters.value as number),
          ])
        : "0x",
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
      txHash = await contract.methods.getTransactionHash(...params).call();
    } catch (e) {
      if (!dryRun) {
        throw e;
      }
      txHash = "0x0000000000000000000000000000000000000000";
    }
    if (threshold > 1) {
      const [to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, nonce] = params;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const wallet = new ethers.Wallet(process.env.WEB3_PRIVATE_KEY!);
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
      const typedData = {
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
      };
      const digest = TypedDataUtils.encodeDigest(typedData);
      const signature = joinSignature(wallet._signingKey().signDigest(digest));
      if (dryRun) {
        return {
          digest: ethers.utils.hexlify(digest),
          signature,
        };
      }
      const resp = await axios.post(
        `https://safe-client.gnosis.io/v1/chains/${chainId}/transactions/${contractAddress}/propose`,
        { origin: "Grindery Nexus", safeTxHash: txHash, signature, sender: await wallet.getAddress(), ...message }
      );
      return resp.data;
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    let signature = await web3.eth.sign(txHash, web3.defaultAccount!);
    // https://github.com/safe-global/safe-contracts/blob/c36bcab46578a442862d043e12a83fec41143dec/contracts/GnosisSafe.sol#L293
    signature =
      signature.slice(0, signature.length - 2) + (parseInt(signature.slice(signature.length - 2), 16) + 4).toString(16);
    params[params.length - 1] = signature;
    const result = await contract.methods.execTransaction(...params).encodeABI();

    return result;
  } finally {
    releaseLock();
  }
}
