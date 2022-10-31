import {
  ConnectorInput,
  ConnectorOutput,
  TriggerBase,
  ConnectorDefinition,
} from "grindery-nexus-common-utils/dist/connector";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import { convert } from "./web3/evm/unitConverter";
import { callSmartContract as _callSmartContract, callSmartContractWebHook, getTriggerClass } from "./web3";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sanitizeParameters(input: ConnectorInput<any>) {
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

export async function setupSignal(params: ConnectorInput): Promise<TriggerBase> {
  await sanitizeParameters(params);
  if (!("chain" in (params.fields as Record<string, unknown>))) {
    throw new InvalidParamsError("Missing chain parameter");
  }
  const trigger = getTriggerClass(params as ConnectorInput<{ chain: string | string[] }>);
  if (trigger) {
    return new trigger(params);
  } else {
    throw new Error(`Invalid trigger: ${params.key}`);
  }
}
export async function callSmartContract(params: ConnectorInput): Promise<ConnectorOutput> {
  await sanitizeParameters(params);
  if (!("chain" in (params.fields as Record<string, unknown>))) {
    throw new InvalidParamsError("Missing chain parameter");
  }
  return await _callSmartContract(params as ConnectorInput<{ chain: string }>);
}


export const CONNECTOR_DEFINITION: ConnectorDefinition = {
  actions: { callSmartContract },
  triggers: { newTransaction: { factory: setupSignal }, newEvent: { factory: setupSignal } },
  webhooks: { callSmartContract: callSmartContractWebHook }
};
