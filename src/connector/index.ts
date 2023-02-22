import { ConnectorDefinition } from "grindery-nexus-common-utils/dist/connector";
import { callSmartContractWebHook } from "../web3";
import {
  genericAbiAction,
  genericAbiActionInputProvider,
  genericAbiTrigger,
  genericAbiTriggerInputProvider,
} from "../web3/evm/connector/genericAbi";
import { clkPriceFeedAction, clkPriceFeedActionInputProvider } from "../web3/evm/connector/chainlink";

import { gnosisSafeSimpleTransfer, gnosisSafeSimpleTransferToken } from "../web3/evm/connector/gnosisSafe";
import {
  safeDepositReceivedERC20,
  safeDepositReceivedNative,
  safeTransactionExecutedAddOwner,
  safeTransactionExecutedOther,
  safeTransactionExecutedRemoveOwner,
  safeTransactionExecutedTransferERC20,
  safeTransactionExecutedTransferNative,
} from "../web3/evm/connector/gnosisSafe/triggers";
import { setupSignal, callSmartContract } from "./entrypoint";

export const CONNECTOR_DEFINITION: ConnectorDefinition = {
  actions: {
    callSmartContract,
    genericAbiAction,
    clkPriceFeedAction,
    gnosisSafeSimpleTransfer,
    gnosisSafeSimpleTransferToken,
  },
  triggers: {
    newTransaction: { factory: setupSignal },
    newTransactionAsset: { factory: setupSignal },
    newTransactionToken: { factory: setupSignal },
    newTransactionNFT: { factory: setupSignal },
    newEvent: { factory: setupSignal },
    genericAbiTrigger: { factory: genericAbiTrigger },
    safeTransactionExecutedTransferNative: { factory: safeTransactionExecutedTransferNative },
    safeTransactionExecutedTransferERC20: { factory: safeTransactionExecutedTransferERC20 },
    safeTransactionExecutedAddOwner: { factory: safeTransactionExecutedAddOwner },
    safeTransactionExecutedRemoveOwner: { factory: safeTransactionExecutedRemoveOwner },
    safeTransactionExecutedOther: { factory: safeTransactionExecutedOther },
    safeDepositReceivedNative: { factory: safeDepositReceivedNative },
    safeDepositReceivedERC20: { factory: safeDepositReceivedERC20 },
  },
  inputProviders: {
    genericAbiAction: genericAbiActionInputProvider,
    genericAbiTrigger: genericAbiTriggerInputProvider,
    clkPriceFeedAction: clkPriceFeedActionInputProvider,
  },
  webhooks: { callSmartContract: callSmartContractWebHook },
};
