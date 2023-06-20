import { ConnectorDefinition } from "grindery-nexus-common-utils/dist/connector";
import { callSmartContractWebHook } from "../web3";
import {
  genericAbiAction,
  genericAbiActionInputProvider,
  genericAbiTrigger,
  genericAbiTriggerInputProvider,
} from "../web3/evm/connector/genericAbi";
import { clkPriceFeedAction, clkPriceFeedActionInputProvider } from "../web3/evm/connector/chainlink";
import { balanceOfActionERC20 } from "../web3/evm/connector/erc20";
import { gnosisSafeSimpleTransfer, gnosisSafeSimpleTransferToken } from "../web3/evm/connector/gnosisSafe";
import {
  safeTransactionExecutedAddOwner,
  safeTransactionExecutedOther,
  safeTransactionRejected,
  safeTransactionExecutedRemoveOwner,
  safeTransactionExecutedTransferERC20,
  safeTransactionExecutedTransferNative,
} from "../web3/evm/connector/gnosisSafe/triggers/execution";
import { safeDepositReceivedERC20, safeDepositReceivedNative } from "../web3/evm/connector/gnosisSafe/triggers/deposit";
import { setupSignal, callSmartContract } from "./entrypoint";
import {
  TransactionNewConfirmationTrigger,
  TransactionProposedTrigger,
  TransactionRejectionNewConfirmationTrigger,
  TransactionRejectionProposedTrigger,
} from "../web3/evm/connector/gnosisSafe/triggers/proposal";
import { layerZeroUpdateHash } from "../web3/evm/connector/layerZero";

export const CONNECTOR_DEFINITION: ConnectorDefinition = {
  actions: {
    callSmartContract,
    genericAbiAction,
    clkPriceFeedAction,
    gnosisSafeSimpleTransfer,
    gnosisSafeSimpleTransferToken,
    layerZeroUpdateHash,
    balanceOfActionERC20,
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
    safeTransactionRejected: { factory: safeTransactionRejected },
    safeTransactionProposed: TransactionProposedTrigger,
    safeTransactionRejectionProposed: TransactionRejectionProposedTrigger,
    safeTransactionNewConfirmation: TransactionNewConfirmationTrigger,
    safeTransactionRejectionNewConfirmation: TransactionRejectionNewConfirmationTrigger,
  },
  inputProviders: {
    genericAbiAction: genericAbiActionInputProvider,
    genericAbiTrigger: genericAbiTriggerInputProvider,
    clkPriceFeedAction: clkPriceFeedActionInputProvider,
  },
  webhooks: { callSmartContract: callSmartContractWebHook },
};
