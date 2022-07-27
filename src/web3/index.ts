import WebSocket from "ws";
import { ConnectorInput, ConnectorOutput, TriggerBase } from "../connectorCommon";
import * as evm from "./evm";
import * as near from "./near";
import * as flow from "./flow";
import { InvalidParamsError } from "../jsonrpc";

const CHAINS = {
  near,
  flow,
};

export function createTrigger(socket: WebSocket, params: ConnectorInput<{ chain: string | string[] }>): TriggerBase {
  const chain = params.fields.chain;
  const triggers = typeof chain === "string" ? (CHAINS[chain] || evm).Triggers : evm.Triggers;

  const type = params.key;
  const trigger = triggers.get(type);
  if (!trigger) {
    throw new InvalidParamsError(`Unknown trigger type: ${type}`);
  }
  return trigger(socket, params);
}

export async function callSmartContract(
  input: ConnectorInput<{
    chain: string;
  }>
): Promise<ConnectorOutput> {
  const chain = input.fields.chain;
  const module = typeof chain === "string" ? CHAINS[chain] || evm : evm;
  return module.callSmartContract(input as Parameters<typeof evm.callSmartContract>[0]);
}
