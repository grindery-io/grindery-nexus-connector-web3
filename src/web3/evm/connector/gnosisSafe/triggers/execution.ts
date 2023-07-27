import axios from "axios";
import { ITriggerInstance, TriggerInit } from "grindery-nexus-common-utils";
import { sanitizeParameters } from "../../../../../utils";
import * as evm from "../../../triggers";
import { API_BASE, processSafeTxInfo } from "../common";
import { NewEventInput } from "../../../../utils";

class NewEventTrigger extends evm.NewEventTrigger {
  predicate = (_payload: Record<string, unknown>) => true;

  protected async processSignal(payload: Record<string, unknown>): Promise<boolean> {
    const resp = await axios
      .get(
        `${API_BASE}v1/chains/${payload._grinderyChainId}/transactions/multisig_${payload._grinderyContractAddress}_${payload.txHash}`
      )
      .catch((e) => {
        console.error("Failed to get transaction data:", e.response?.data || e, { payload });
      });
    if (!resp) {
      return false;
    }
    delete payload.payment;
    const safeTxInfo = resp.data;
    if (safeTxInfo.txInfo?.isCancellation) {
      const resp = await axios
        .get(
          `${API_BASE}v1/chains/${payload._grinderyChainId}/safes/${payload._grinderyContractAddress}/multisig-transactions?nonce=${safeTxInfo.detailedExecutionInfo?.nonce}`
        )
        .catch((e) => {
          console.error("Failed to get rejected transaction data:", e.response?.data || e, { payload });
        });
      const rejectedTxInfo = resp?.data?.results?.map((x) => x.transaction)?.find((x) => x.txStatus === "CANCELLED");
      if (rejectedTxInfo) {
        payload.rejectedType = processSafeTxInfo(rejectedTxInfo, payload);
      }
      payload.nonce = safeTxInfo.detailedExecutionInfo?.nonce;
      payload.type = "rejection";
    } else {
      const type = processSafeTxInfo(safeTxInfo, payload);
      payload.type = type;
    }
    if (this.predicate(payload)) {
      return false;
    }
    return true;
  }
}

export async function safeTransactionExecuted(
  input: TriggerInit,
  predicate = (_payload: Record<string, unknown>) => true
): Promise<ITriggerInstance> {
  const ret = new NewEventTrigger(
    await sanitizeParameters({
      ...input,
      fields: {
        ...(input.fields as object),
        eventDeclaration: "ExecutionSuccess(bytes32 txHash, uint256 payment)",
        parameterFilters: {},
      } as NewEventInput,
    })
  );
  ret.predicate = predicate;
  return ret;
}

export const safeTransactionExecutedTransferNative = async (input: TriggerInit) =>
  safeTransactionExecuted(input, (payload) => payload.type === "transfer_native_coin");
export const safeTransactionExecutedTransferERC20 = async (input: TriggerInit) =>
  safeTransactionExecuted(input, (payload) => payload.type === "transfer_erc20");
export const safeTransactionExecutedAddOwner = async (input: TriggerInit) =>
  safeTransactionExecuted(input, (payload) => payload.type === "add_owner");
export const safeTransactionExecutedRemoveOwner = async (input: TriggerInit) =>
  safeTransactionExecuted(input, (payload) => payload.type === "remove_owner");
export const safeTransactionExecutedOther = async (input: TriggerInit) =>
  safeTransactionExecuted(input, (payload) => payload.type === "other");

export const safeTransactionRejected = async (input: TriggerInit) =>
  safeTransactionExecuted(input, (payload) => payload.type === "rejection");
