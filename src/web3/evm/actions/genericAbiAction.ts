import { ConnectorInput, ActionOutput, InputProviderInput, InputProviderOutput } from "grindery-nexus-common-utils";
import { FieldSchema } from "grindery-nexus-common-utils/dist/types";
import { AbiItem, AbiInput, AbiOutput } from "web3-utils";
import axios from 'axios'

type Fields = {
  _grinderyChain: string;
  _grinderyContractAddress: string;
  _grinderyAbi?: string;
  _grinderyFunction?: string;
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
function abiInputToField(inp: AbiInput | AbiOutput) {
  return {
    key: inp.name,
    label: `${inp.name} (${inp.type})`,
    type: mapType(inp.type),
    placeholder: inp.type === "address" ? "Enter a blockchain address" : "",
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
      "returns " +
        (abiItem.outputs.length === 1 ? abiItem.outputs[0].type : abiItem.outputs.map((x) => x.type).join(", "))
    );
  }
  if (!items.length) {
    return "";
  }
  return " " + items.join(" ");
}

const getCDS = (ABI: string) => {
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
          outputFields: x.inputs.map(abiInputToField),
          sample: {},
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
              ? [
                  {
                    key: "returnValue",
                    label: "Return value of " + x.name,
                    type: mapType(x.outputs?.[0].type),
                  } as FieldSchema,
                ]
              : [],
          sample: {},
        },
      })),
  };

  return cds;
};

export async function genericAbiActionInputProvider(params: InputProviderInput<unknown>): Promise<InputProviderOutput> {
  const fieldData = params.fieldData as Fields;
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
        label: "Contract address",
      },
      {
        key: "_grinderyAbi",
        required: true,
        type: "text",
        label: "ABI",
      },
    ],
  };
  if(fieldData?._grinderyChain && fieldData?._grinderyContractAddress && !fieldData?._grinderyAbi){
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let abi: any
    try {
      abi = await axios.get(`https://nexus-cds-editor-api.herokuapp.com/api/abi?blockchain=${fieldData?._grinderyChain}&address=${fieldData?._grinderyContractAddress}`)
    } catch(error){
      // handle abi retrieving  error
    }
    if(abi?.result){
      ret.inputFields[2]['default'] = abi?.result
    }
  }
  if (fieldData?._grinderyAbi) {
    const cds = getCDS(fieldData._grinderyAbi);
    ret.inputFields.push({
      key: "_grinderyFunction",
      required: true,
      type: "string",
      label: "Function",
      choices: cds.actions.map((x) => ({
        value: x.key,
        sample: x.key,
        label: x.operation.signature,
      })),
    });
    if (fieldData?._grinderyFunction) {
      const action = cds.actions.find((x) => x.key === fieldData._grinderyFunction);
      if (action) {
        ret.inputFields = ret.inputFields.concat(
          action.operation.inputFields.map((x) => ({ ...x, updateFieldDefinition: false } as FieldSchema))
        );
        ret.outputFields = action.operation.outputFields;
      }
    }
  }
  return ret;
}

export async function genericAbiAction(input: ConnectorInput<unknown>): Promise<ActionOutput> {
  console.log(input);
  return { payload: {} };
}
