import WebSocket from "ws";
import { ConnectorInput, ConnectorOutput } from "./connectorCommon";
import { InvalidParamsError } from "./jsonrpc";
import { convert } from "./unitConverter";
import { callSmartContract, createTrigger } from "./web3";

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

export async function setupSignal(params: ConnectorInput, { socket }: { socket: WebSocket }) {
  await sanitizeParameters(params);
  if (!("chain" in (params.fields as Record<string, unknown>))) {
    throw new InvalidParamsError("Missing chain parameter");
  }
  const trigger = createTrigger(socket, params as ConnectorInput<{ chain: string | string[] }>);
  if (trigger) {
    trigger.start();
  } else {
    throw new Error(`Invalid trigger: ${params.key}`);
  }
  return {};
}
export async function runAction(params: ConnectorInput): Promise<ConnectorOutput> {
  await sanitizeParameters(params);
  if (!("chain" in (params.fields as Record<string, unknown>))) {
    throw new InvalidParamsError("Missing chain parameter");
  }
  if (params.key === "callSmartContract") {
    return await callSmartContract(params as Parameters<typeof callSmartContract>[0]);
  } else {
    throw new Error(`Invalid action: ${params.key}`);
  }
}
