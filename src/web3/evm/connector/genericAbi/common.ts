import { FieldSchema } from "grindery-nexus-common-utils/dist/types";
import { AbiItem, AbiInput, AbiOutput } from "web3-utils";
import axios from "axios";
import { InputProviderOutput } from "grindery-nexus-common-utils";

export type CommonFields = {
  _grinderyChain: string;
  _grinderyContractAddress: string;
  _grinderyAbi?: string;
  _grinderyUseCustomAbi?: boolean;
};

function mapType(abiType: string) {
  abiType = abiType.replace("[]", "");
  const NUMBER_TYPES = ["uint8", "uint16", "uint32", "int8", "int16", "int32", "bytes1"];
  if (NUMBER_TYPES.includes(abiType)) {
    return "number";
  }
  if (abiType === "bool") {
    return "boolean";
  }
  if (abiType === "address") {
    return "address";
  }
  return "string";
}
function getSampleValue(abiType: string) {
  if (abiType.includes("[]")) {
    return "[]";
  }
  const NUMBER_TYPES = ["uint8", "uint16", "uint32", "int8", "int16", "int32", "bytes1"];
  if (NUMBER_TYPES.includes(abiType)) {
    return "123";
  }
  if (abiType === "bool") {
    return "true";
  }
  if (abiType === "string") {
    return "Sample value";
  }
  if (abiType === "address") {
    return "0x9c3F02A7010b122Fd218DFdd46F83E2BeeA09ad2";
  }
  if (abiType === "bytes32") {
    return "0x111122223333444455556666777788889999aaaa";
  }
  return "0";
}
function abiInputToField(inp: AbiInput | AbiOutput) {
  return {
    key: inp.name,
    label: `${inp.name} (${inp.type})`,
    type: mapType(inp.type),
    helpText: inp.type === "address" ? "Enter a blockchain address" : "",
    list: inp.type.includes("[]"),
  };
}
function getFunctionSuffix(abiItem: AbiItem) {
  const items = [] as string[];
  if (abiItem.payable) {
    items.push("payable");
  }
  if (abiItem.constant) {
    items.push("view");
  }
  if (abiItem.stateMutability === "pure") {
    items.push("pure");
  }
  if (abiItem.outputs?.length) {
    items.push(
      `returns (${
        abiItem.outputs.length === 1
          ? abiItem.outputs[0].type
          : abiItem.outputs.map((x, index) => `${x.type} ${x.name || "return" + index}`).join(", ")
      })`
    );
  }
  if (!items.length) {
    return "";
  }
  return " " + items.join(" ");
}
export const getCDS = (ABI: string) => {
  let parsedInput = [] as AbiItem[];
  if (ABI) {
    parsedInput = JSON.parse(ABI);
    if (!Array.isArray(parsedInput)) {
      throw Error("Invalid ABI");
    }
  }

  const cds = {
    triggers: parsedInput
      .filter((x) => x.type === "event")
      .map((x) => ({
        ...x,
        inputs: (x.inputs || []).map((x, i) => ({
          ...x,
          name: x.name || "param" + i,
        })),
      }))
      .map((x) => ({
        key: x.name + "Trigger",
        operation: {
          type: "blockchain:event",
          signature: `event ${x.name}(${x.inputs
            .map((inp) => `${inp.type} ${inp.indexed ? "indexed " : ""}${inp.name}`)
            .join(", ")})`,
          inputFields: x.inputs.map(abiInputToField),
          outputFields: (x.inputs.map(abiInputToField) as FieldSchema[]).concat([
            { key: "_grinderyTransactionHash", label: "Transaction hash", type: "string" },
            { key: "_grinderyChainId", label: "Chain ID", type: "string" },
          ]),
          sample: {
            _grinderyTransactionHash: "0x19bbca58d22d704e98da94f0fade1c9be9bffa9a222539ba6b7f6ae193e4ef5a",
            _grinderyChainId: "5",
            ...Object.fromEntries(x.inputs.map((inp) => [inp.name, getSampleValue(inp.type)])),
          },
        },
      })),
    actions: parsedInput
      .filter((x) => x.type === "function")
      .map((x) => ({
        ...x,
        inputs: (x.inputs || []).map((x, i) => ({
          ...x,
          name: x.name || "param" + i,
        })),
      }))
      .map((x) => ({
        key: x.name + "Action",
        operation: {
          type: "blockchain:call",
          signature: `function ${x.name}(${x.inputs
            .map((inp) => `${inp.type} ${inp.name}`)
            .join(", ")})${getFunctionSuffix(x)}`,
          inputFields: x.inputs.map(abiInputToField).map((x) => ({ ...x, required: true })),
          outputFields:
            (x.constant || x.stateMutability === "pure") && x.outputs?.length === 1
              ? ([
                  {
                    key: "returnValue",
                    label: "Return value of " + x.name,
                    type: mapType(x.outputs?.[0].type),
                  },
                  { key: "transactionHash", label: "Transaction hash", type: "string" },
                  { key: "contractAddress", label: "Contract address", type: "string" },
                ] as FieldSchema[])
              : [],
          sample:
            (x.constant || x.stateMutability === "pure") && x.outputs?.length === 1
              ? {
                  returnValue: getSampleValue(x.outputs?.[0].type || "string"),
                  transactionHash: "0x19bbca58d22d704e98da94f0fade1c9be9bffa9a222539ba6b7f6ae193e4ef5a",
                  contractAddress: "0x88ec574e2ef0ecf9043373139099f7e535f94dbc",
                }
              : {},
        },
      })),
  };

  return cds;
};
const fetchAbiCache = new Map<string, string | { missing: true; timestamp: number }>();
export async function fetchAbi(chain: string, contractAddress: string) {
  let fetchedAbi: string | undefined;
  const cacheKey = `${chain}/${contractAddress}`;
  let cached = fetchAbiCache.get(cacheKey);
  if (typeof cached === "string") {
    fetchedAbi = cached;
  } else if (cached?.missing && Date.now() - cached.timestamp > 60000) {
    cached = undefined;
  }
  if (!cached) {
    try {
      const resp = await axios.get(
        `https://nexus-cds-editor-api.herokuapp.com/api/abi?blockchain=${chain}&address=${contractAddress}`
      );
      const rawAbi = resp.data?.result;
      getCDS(rawAbi);
      // At this point we can confirm that the fetched ABI is valid
      fetchAbiCache.set(cacheKey, rawAbi);
      fetchedAbi = rawAbi;
    } catch (error) {
      // handle abi retrieving  error
      fetchAbiCache.set(cacheKey, { missing: true, timestamp: Date.now() });
    }
  }
  return fetchedAbi;
}

export async function prepareOutput(fieldData: CommonFields) {
  const ret: InputProviderOutput = {
    inputFields: [
      {
        key: "_grinderyChain",
        required: true,
        type: "string",
        label: "Blockchain",
      },
      {
        key: "_grinderyContractAddress",
        required: true,
        type: "address",
        label: "Smart Contract Address",
        helpText:
          "Indicate the address of the smart contract you want to interact with. Make sure the address matches the block chain you selected.",
      },
    ],
  };

  // Get ABI if chain and contract specified
  let fetchedAbi = undefined as string | undefined;
  if (fieldData?._grinderyChain && fieldData?._grinderyContractAddress && !fieldData?._grinderyUseCustomAbi) {
    const chain = fieldData._grinderyChain;
    const contractAddress = fieldData._grinderyContractAddress;
    fetchedAbi = await fetchAbi(chain, contractAddress);
  }

  if (fieldData?._grinderyChain && fieldData?._grinderyContractAddress) {
    // Allow user to manually set ABI
    if (fetchedAbi || fieldData?._grinderyUseCustomAbi) {
      ret.inputFields.push({
        key: "_grinderyUseCustomAbi",
        type: "boolean",
        label: "Set ABI manually",
        default: "false",
        helpText:
          "If set to FALSE Grindery will try to get the ABI automatically ABI. If set to TRUE if can set the ABI yourself manually.",
      });
    }
    // Add abi field only if chain and address specified, and we can't fetch ABI from explorer site
    if (!fetchedAbi || fieldData?._grinderyUseCustomAbi) {
      ret.inputFields.push({
        key: "_grinderyAbi",
        required: true,
        type: "text",
        label: "Custom ABI",
        helpText:
          "Paste the contract ABI. This can be obtained either in [Remix](https://docs.moonbeam.network/builders/build/eth-api/dev-env/remix/) or in the .json file generally created after the compilation process (for example, in Truffle or HardHat).",
      });
    }
  }

  const abiJson = !fetchedAbi || fieldData?._grinderyUseCustomAbi ? fieldData?._grinderyAbi : fetchedAbi;
  return { cds: abiJson ? getCDS(abiJson) : undefined, ret };
}
