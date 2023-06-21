import { ConnectorInput, ConnectorOutput, TriggerBase } from "grindery-nexus-common-utils/dist/connector";
import * as evm from "./evm";
import * as near from "./near";
import * as neartest from "./near";
import * as flow from "./flow";
import * as algorand from "./algorand/algorand";
import * as algorandtest from "./algorand/algorand";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import { TAccessToken } from "../jwt";

export * from "./webhook";

export const CHAINS: {
  [key: string]: {
    callSmartContract(input: ConnectorInput<unknown>): Promise<ConnectorOutput>;
    getUserDroneAddress(user: TAccessToken): Promise<string>;
    Triggers: Map<string, new (params: ConnectorInput) => TriggerBase>;
  };
} = {
  near,
  "near:mainnet": near,
  neartest,
  "near:testnet": neartest,
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
  const module = typeof params.fields.chain === "string" ? (CHAINS[params.fields.chain] || evm).Triggers : evm.Triggers;
  const trigger = module.get(params.key);
  if (!trigger) {
    throw new InvalidParamsError(`Unknown trigger type: ${params.key}`);
  }
  return trigger;
}

export async function callSmartContract(
  input: ConnectorInput<{
    chain: string;
  }>
): Promise<ConnectorOutput> {
  const module = typeof input.fields.chain === "string" ? CHAINS[input.fields.chain] || evm : evm;
  return module.callSmartContract(input as Parameters<typeof evm.callSmartContract>[0]);
}
