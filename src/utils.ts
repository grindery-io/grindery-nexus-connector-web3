import { ConnectorInput } from "grindery-nexus-common-utils/dist/connector";
import { convert } from "./web3/evm/unitConverter";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sanitizeParameters(input: ConnectorInput<any>) {
  if ("_grinderyChain" in input.fields) {
    input.fields.chain = input.fields._grinderyChain;
    delete input.fields._grinderyChain;
  }
  for (const paramKey of ["parameterFilters", "parameters"]) {
    if (paramKey in input.fields) {
      const parameters = input.fields[paramKey];
      for (const key of Object.keys(parameters)) {
        if (parameters[key] === "!!GRINDERY!!UNDEFINED!!") {
          parameters[key] = undefined;
        }
        const unitConversionMode = parameters["_grinderyUnitConversion_" + key];
        if (unitConversionMode) {
          parameters[key] = await convert(parameters[key], unitConversionMode, input.fields, parameters);
        }
      }
    }
  }
  return input;
}
