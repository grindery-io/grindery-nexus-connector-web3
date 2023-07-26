import { ConnectorInput, ConnectorOutput, TriggerBase, TriggerInit } from "grindery-nexus-common-utils/dist/connector";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import { callSmartContract as _callSmartContract, getTriggerClass } from "../web3";
import { sanitizeParameters } from "../utils";
import { TriggerBasePayload, TriggerBaseState } from "../web3/utils";

export async function setupSignal(
  params: TriggerInit<any, TriggerBasePayload, TriggerBaseState>
): Promise<TriggerBase> {
  await sanitizeParameters(params);
  if (!("chain" in (params.fields as Record<string, unknown>))) {
    throw new InvalidParamsError("Missing chain parameter");
  }
  const Trigger = getTriggerClass(params as TriggerInit<any, TriggerBasePayload, TriggerBaseState>);
  if (Trigger) {
    return new Trigger(params);
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
