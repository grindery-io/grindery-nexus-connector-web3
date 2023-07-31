import { ConnectorInput } from "grindery-nexus-common-utils/dist/connector";
import { convert } from "./web3/evm/unitConverter";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sanitizeObject(parameters: Record<string, unknown>, input: ConnectorInput<any>) {
  for (const key of Object.keys(parameters)) {
    parameters[key] =
      parameters[key] === "!!GRINDERY!!UNDEFINED!!"
        ? undefined
        : parameters["_grinderyUnitConversion_" + key]
        ? await convert(
            parameters[key],
            parameters["_grinderyUnitConversion_" + key] as string,
            input.fields,
            parameters
          )
        : parameters[key];
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
