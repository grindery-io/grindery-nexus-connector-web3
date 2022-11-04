import {
  ActionOutput,
  ConnectorInput,
  ConnectorOutput,
  TriggerBase,
  WebhookParams,
} from "grindery-nexus-common-utils/dist/connector";
import * as evm from "./evm";
import * as near from "./near";
import * as flow from "./flow";
import * as algorand from "./algorand/algorand";
import * as algorandtest from "./algorand/algorand";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import { parseUserAccessToken, TAccessToken } from "../jwt";

const CHAINS: {
  [key: string]: {
    callSmartContract(input: ConnectorInput<unknown>): Promise<ConnectorOutput>;
    getUserDroneAddress(user: TAccessToken): Promise<string>;
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
export async function callSmartContractWebHook(params: ConnectorInput<WebhookParams>): Promise<ActionOutput> {
  if (params.fields.method !== "POST") {
    throw new Error("Unsupported method");
  }
  if (params.fields.path === "getDroneAddress") {
    const { token, chain } = (params.fields.payload || {}) as { token: string; chain: string };
    if (!token || !chain) {
      throw new Error("Missing parameter");
    }
    const user = await parseUserAccessToken(token).catch(() => null);
    if (!user) {
      throw new Error("Invalid access token");
    }
    let droneAddress: string;
    if (CHAINS[chain]) {
      droneAddress = await CHAINS[chain].getUserDroneAddress(user);
    } else {
      if (!/^eip155:\d+$/.exec(chain)) {
        throw new Error("Invalid chain");
      }
      droneAddress = await evm.getUserDroneAddress(user);
    }
    return { payload: { droneAddress } };
  } else {
    throw new Error("Unsupported call");
  }
}
