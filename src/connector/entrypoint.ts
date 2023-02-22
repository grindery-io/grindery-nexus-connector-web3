import { ConnectorInput, ConnectorOutput, TriggerBase } from "grindery-nexus-common-utils/dist/connector";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import { callSmartContract as _callSmartContract, getTriggerClass } from "../web3";
import { sanitizeParameters } from "../utils";

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
