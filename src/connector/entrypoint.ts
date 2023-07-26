import { ConnectorInput, ConnectorOutput, TriggerBase, TriggerInit } from "grindery-nexus-common-utils/dist/connector";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import { callSmartContract as _callSmartContract, getTriggerClass } from "../web3";
import { sanitizeParameters } from "../utils";
import {
  NewEventInput,
  NewTransactionFlowInput,
  NewTransactionInput,
  TriggerBasePayload,
  TriggerBaseState,
} from "../web3/utils";

// Overloads for setupSignal based on trigger types
export async function setupSignal(
  params: TriggerInit<NewEventInput, TriggerBasePayload, TriggerBaseState>
): Promise<TriggerBase<NewEventInput>>;

export async function setupSignal(
  params: TriggerInit<NewTransactionInput, TriggerBasePayload, TriggerBaseState>
): Promise<TriggerBase<NewTransactionInput>>;

export async function setupSignal(
  params: TriggerInit<NewTransactionFlowInput, TriggerBasePayload, TriggerBaseState>
): Promise<TriggerBase<NewTransactionFlowInput>>;

// Implementation of setupSignal function
export async function setupSignal(
  params:
    | TriggerInit<NewEventInput, TriggerBasePayload, TriggerBaseState>
    | TriggerInit<NewTransactionInput, TriggerBasePayload, TriggerBaseState>
    | TriggerInit<NewTransactionFlowInput, TriggerBasePayload, TriggerBaseState>
): Promise<TriggerBase> {
  await sanitizeParameters(params);
  if (!("chain" in (params.fields as Record<string, unknown>))) {
    throw new InvalidParamsError("Missing chain parameter");
  }
  const Trigger = getTriggerClass(params);
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
