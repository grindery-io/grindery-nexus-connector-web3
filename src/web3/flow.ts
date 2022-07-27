import WebSocket from "ws";
import * as fcl from "@onflow/fcl";
import { ConnectorInput, ConnectorOutput, TriggerBase } from "../connectorCommon";
import { InvalidParamsError } from "../jsonrpc";

class NewTransactionTrigger extends TriggerBase<{ chain: string | string[]; from?: string; to?: string }> {
  async main() {
    throw new Error("Method not implemented.");
  }
}
class NewEventTrigger extends TriggerBase<{
  chain: string | string[];
  contractAddress?: string;
  eventDeclaration: string | string[];
  parameterFilters: { [key: string]: unknown };
}> {
  async main() {
    fcl.config().put("accessNode.api", "https://rest-mainnet.onflow.org");
    fcl.events("A.231cc0dbbcffc4b7.RLY.TokensDeposited").subscribe((event) => {
      console.log(event);
    });
    await this.waitForStop();
  }
}

export const Triggers = new Map<string, (socket: WebSocket, params: ConnectorInput) => TriggerBase>();
Triggers.set("newTransaction", (socket, params) => new NewTransactionTrigger(socket, params));
Triggers.set("newEvent", (socket, params) => new NewEventTrigger(socket, params));

export async function callSmartContract(
  input: ConnectorInput<{
    chain: string;
    contractAddress: string;
    functionDeclaration: string;
    parameters: { [key: string]: unknown };
    maxFeePerGas?: string | number;
    maxPriorityFeePerGas?: string | number;
    gasLimit?: string | number;
    dryRun?: boolean;
  }>
): Promise<ConnectorOutput> {
  console.log("callSmartContract", input);
  throw new Error("Not implemented");
}
