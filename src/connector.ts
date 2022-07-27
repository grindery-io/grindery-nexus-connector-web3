import WebSocket from "ws";
import { ConnectorInput, ConnectorOutput } from "./connectorCommon";
import { InvalidParamsError } from "./jsonrpc";
import { callSmartContract, createTrigger } from "./web3";

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
  sanitizeParameters(params);
  if (!("chain" in (params.fields as Record<string, unknown>))) {
    throw new InvalidParamsError("Missing chain parameter");
  }
  if (params.key === "callSmartContract") {
    return await callSmartContract(params as Parameters<typeof callSmartContract>[0]);
  } else {
    throw new Error(`Invalid action: ${params.key}`);
  }
}
