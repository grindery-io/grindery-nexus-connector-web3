import { ConnectorInput, ConnectorOutput, TriggerBase } from "grindery-nexus-common-utils/dist/connector";
import * as evm from "./evm";
import * as near from "./near";
import * as flow from "./flow";
import * as algorand from "./algorand/algorand";
import * as algorandtest from "./algorand/algorand";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";

const CHAINS: {
  [key: string]: {
    callSmartContract(input: ConnectorInput<unknown>): Promise<ConnectorOutput>;
    Triggers: Map<string, new (params: ConnectorInput) => TriggerBase>;
  };
} = {
  near,
  "near:mainnet": near,
  flow,
  "flow:mainnet": flow,
  algorand,
  "algorand:mainnet": algorand,
  algorandtest,
  "algorand:testnet": algorandtest,
};

export function getTriggerClass(
  params: ConnectorInput<{ chain: string | string[] }>
): new (params: ConnectorInput) => TriggerBase {
  const chain = params.fields.chain;
  const triggers = typeof chain === "string" ? (CHAINS[chain] || evm).Triggers : evm.Triggers;

  const type = params.key;
  const trigger = triggers.get(type);
  if (!trigger) {
    throw new InvalidParamsError(`Unknown trigger type: ${type}`);
  }
  return trigger;
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
