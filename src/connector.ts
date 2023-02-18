import {
  ConnectorInput,
  ConnectorOutput,
  TriggerBase,
  ConnectorDefinition,
} from "grindery-nexus-common-utils/dist/connector";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import { callSmartContract as _callSmartContract, getTriggerClass } from "./web3";
import { callSmartContractWebHook } from "./web3";
import {
  genericAbiAction,
  genericAbiActionInputProvider,
  genericAbiTrigger,
  genericAbiTriggerInputProvider,
} from "./web3/evm/connector/genericAbi";
import { clkPriceFeedAction, clkPriceFeedActionInputProvider } from "./web3/evm/connector/chainlink";

import { sanitizeParameters } from "./utils";
import { gnosisSafeSimpleTransfer } from "./web3/evm/connector/gnosisSafe";

export async function setupSignal(params: ConnectorInput): Promise<TriggerBase> {
  await sanitizeParameters(params);
  if (!("chain" in (params.fields as Record<string, unknown>))) {
    throw new InvalidParamsError("Missing chain parameter");
  }
  const trigger = getTriggerClass(params as ConnectorInput<{ chain: string | string[] }>);
  if (trigger) {
    return new trigger(params);
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

export const CONNECTOR_DEFINITION: ConnectorDefinition = {
  actions: {
    callSmartContract,
    genericAbiAction,
    clkPriceFeedAction,
    gnosisSafeSimpleTransfer,
  },
  triggers: {
    newTransaction: { factory: setupSignal },
    newTransactionAsset: { factory: setupSignal },
    newTransactionToken: { factory: setupSignal },
    newTransactionNFT: { factory: setupSignal },
    newEvent: { factory: setupSignal },
    genericAbiTrigger: { factory: genericAbiTrigger },
  },
  inputProviders: {
    genericAbiAction: genericAbiActionInputProvider,
    genericAbiTrigger: genericAbiTriggerInputProvider,
    clkPriceFeedAction: clkPriceFeedActionInputProvider,
  },
  webhooks: { callSmartContract: callSmartContractWebHook },
};
