import WebSocket from "ws";
import { ConnectorInput, ConnectorOutput, TriggerBase } from "./connectorCommon";
import { callSmartContract, NewEventTrigger, NewTransactionTrigger } from "./web3";

const triggers = new Map<string, (socket: WebSocket, params: ConnectorInput) => TriggerBase>();
triggers.set("newTransaction", (socket, params) => new NewTransactionTrigger(socket, params));
triggers.set("newEvent", (socket, params) => new NewEventTrigger(socket, params));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sanitizeParameters(params: ConnectorInput<any>) {
  if ("_grinderyChain" in params.fields) {
    params.fields.chain = params.fields._grinderyChain;
    delete params.fields._grinderyChain;
  }
  return params;
}

export async function setupSignal(params: ConnectorInput, { socket }: { socket: WebSocket }) {
  sanitizeParameters(params);
  if (triggers.has(params.key)) {
    triggers.get(params.key)?.(socket, params).start();
  } else {
    throw new Error(`Invalid trigger: ${params.key}`);
  }
  return {};
}
export async function runAction(params: ConnectorInput): Promise<ConnectorOutput> {
  sanitizeParameters(params);
  if (params.key === "callSmartContract") {
    return await callSmartContract(params as Parameters<typeof callSmartContract>[0]);
  } else {
    throw new Error(`Invalid action: ${params.key}`);
  }
}
