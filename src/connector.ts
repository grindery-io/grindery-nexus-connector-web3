import WebSocket from "ws";
import { ConnectorInput, ConnectorOutput, TriggerBase } from "./connectorCommon";
import { callSmartContract, NewEventTrigger, NewTransactionTrigger } from "./web3";

const triggers = new Map<string, (socket: WebSocket, params: ConnectorInput) => TriggerBase>();
triggers.set("newTransaction", (socket, params) => new NewTransactionTrigger(socket, params));
triggers.set("newEvent", (socket, params) => new NewEventTrigger(socket, params));

export async function setupSignal(params: ConnectorInput, { socket }: { socket: WebSocket }) {
  if (triggers.has(params.key)) {
    triggers.get(params.key)?.(socket, params).start();
  } else {
    throw new Error(`Invalid trigger: ${params.key}`);
  }
  return {};
}
export async function runAction(params: ConnectorInput): Promise<ConnectorOutput> {
  if (params.key === "callSmartContract") {
    return await callSmartContract(params as Parameters<typeof callSmartContract>[0]);
  } else {
    throw new Error(`Invalid action: ${params.key}`);
  }
}
