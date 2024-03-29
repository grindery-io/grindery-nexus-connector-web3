import { ConnectorInput } from "grindery-nexus-common-utils/dist/connector";
import { convert } from "./web3/evm/unitConverter";

export const ACCOUNTING_SIMPLE_ACTIONS = "2000000000";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sanitizeObject(parameters: Record<string, unknown>, input: ConnectorInput<any>) {
  for (const key of Object.keys(parameters)) {
    if (parameters[key] === "!!GRINDERY!!UNDEFINED!!") {
      parameters[key] = undefined;
    }
    const unitConversionMode = parameters["_grinderyUnitConversion_" + key];
    if (unitConversionMode) {
      parameters[key] = await convert(parameters[key], unitConversionMode as string, input.fields, parameters);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sanitizeParameters<T extends ConnectorInput<any>>(
  input: T,
  paramKeys = ["parameterFilters", "parameters"]
) {
  if ("_grinderyContractAddress" in input.fields) {
    input.fields.contractAddress = input.fields._grinderyContractAddress;
    delete input.fields._grinderyContractAddress;
  }
  if ("_grinderyChain" in input.fields) {
    input.fields.chain = input.fields._grinderyChain;
    delete input.fields._grinderyChain;
  }
  for (const paramKey of paramKeys || []) {
    if (paramKey in input.fields) {
      const parameters = input.fields[paramKey];
      await sanitizeObject(parameters, input);
    }
  }
  if (!paramKeys?.length) {
    await sanitizeObject(input.fields, input);
  }
  return input;
}
