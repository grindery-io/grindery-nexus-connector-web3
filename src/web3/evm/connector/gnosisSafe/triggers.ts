import axios from "axios";
import { ethers } from "ethers";
import { ConnectorInput, TriggerBase } from "grindery-nexus-common-utils";
import { sanitizeParameters } from "../../../../utils";

import * as evm from "../../triggers";

export async function safeTransactionExecuted(
  input: ConnectorInput,
  predicate = (_payload: Record<string, unknown>) => true
): Promise<TriggerBase> {
  const ret = new evm.NewEventTrigger(
    await sanitizeParameters({
      ...input,
      fields: {
        ...(input.fields as object),
        eventDeclaration: "ExecutionSuccess(bytes32 txHash, uint256 payment)",
        parameterFilters: {},
      },
    })
  );
  ret.on("processSignal", async (payload) => {
    const resp = await axios
      .get(
        `https://safe-client.gnosis.io/v1/chains/${payload._grinderyChainId}/transactions/multisig_${payload._grinderyContractAddress}_${payload.txHash}`
      )
      .catch((e) => {
        console.error("Failed to get transaction data:", e.response?.data || e, { payload });
      });
    if (!resp) {
      return false;
    }
    delete payload.payment;
    const safeTxInfo = resp.data;
    payload.safeTxInfo = safeTxInfo;
    if (safeTxInfo.detailedExecutionInfo) {
      Object.assign(payload, safeTxInfo.detailedExecutionInfo);
    }
    let type = "other";
    if (safeTxInfo.txInfo?.transferInfo) {
      if (safeTxInfo.txInfo?.transferInfo?.value) {
        payload.value = safeTxInfo.txInfo?.transferInfo?.value;
        payload.valueFormatted = safeTxInfo.txInfo.transferInfo.valueFormatted = ethers.utils.formatUnits(
          safeTxInfo.txInfo?.transferInfo?.value,
          safeTxInfo.txInfo?.transferInfo?.decimals || "ether"
        );
        for (const key of ["tokenAddress", "tokenName", "tokenSymbol", "logoUri", "decimals"]) {
          if (key in safeTxInfo.txInfo.transferInfo) {
            payload[key] = safeTxInfo.txInfo.transferInfo[key];
          }
        }
        type = `transfer_${safeTxInfo.txInfo.transferInfo.type?.toLowerCase() || "unknown"}`;
      }
      safeTxInfo.txInfo.sender = safeTxInfo.txInfo.sender?.value || safeTxInfo.txInfo.sender;
      safeTxInfo.txInfo.recipient = safeTxInfo.txInfo.recipient?.value || safeTxInfo.txInfo.recipient;
    }
    if (safeTxInfo.txInfo.type === "SettingsChange") {
      type = safeTxInfo.txInfo.settingsInfo?.type?.toLowerCase() || "settings_change";
      if (safeTxInfo.txInfo.settingsInfo.owner) {
        safeTxInfo.txInfo.owner = safeTxInfo.txInfo.settingsInfo.owner.value || safeTxInfo.txInfo.settingsInfo.owner;
      }
    }
    Object.assign(payload, safeTxInfo.txInfo || {});
    payload.type = type;
    if (!predicate(payload)) {
      return false;
    }
  });
  return ret;
}

export async function safeDepositReceivedNative(input: ConnectorInput): Promise<TriggerBase> {
  const ret = new evm.NewEventTrigger(
    await sanitizeParameters({
      ...input,
      fields: {
        ...(input.fields as object),
        eventDeclaration: "SafeReceived(address indexed sender, uint256 value)",
        parameterFilters: {},
      },
    })
  );
  ret.on("processSignal", async (payload) => {
    if (String(payload.value) === "0") {
      return false;
    }
    payload.valueFormatted = ethers.utils.formatUnits(payload.value as string, "ether");
  });
  return ret;
}
export async function safeDepositReceivedERC20(input: ConnectorInput): Promise<TriggerBase> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input = (await sanitizeParameters(input)) as any;
  const ret = new evm.NewEventTrigger(
    await sanitizeParameters({
      ...input,
      fields: {
        ...(input.fields as object),
        contractAddress: "0x0",
        eventDeclaration: [
          "Transfer(address indexed sender, address indexed to, uint256 value)",
          "Transfer(address indexed sender, address indexed to, uint256 value, bytes data)",
        ],
        parameterFilters: { to: (input.fields as Record<string, unknown>).contractAddress },
      },
    })
  );
  ret.on("processSignal", async (payload) => {
    if (String(payload.value) === "0") {
      return false;
    }
    const resp = await axios
      .get(
        `https://safe-client.gnosis.io/v1/chains/${payload._grinderyChainId}/safes/${payload.to}/incoming-transfers/?to=${payload.to}&token_address=${payload._grinderyContractAddress}&value=${payload.value}&limit=1`
      )
      .catch((e) => {
        console.error("Failed to get transaction data:", e.response?.data || e, { payload });
      });
    if (!resp) {
      return false;
    }
    const transferInfo = resp.data.results?.[0]?.transaction?.txInfo?.transferInfo;
    if (!transferInfo) {
      return false;
    }
    Object.assign(payload, transferInfo);
    payload.valueFormatted = ethers.utils.formatUnits(payload.value as string, transferInfo.decimals || "ether");
  });
  return ret;
}

export const safeTransactionExecutedTransferNative = async (input: ConnectorInput) =>
  safeTransactionExecuted(input, (payload) => payload.type === "transfer_native_coin");
export const safeTransactionExecutedTransferERC20 = async (input: ConnectorInput) =>
  safeTransactionExecuted(input, (payload) => payload.type === "transfer_erc20");
export const safeTransactionExecutedAddOwner = async (input: ConnectorInput) =>
  safeTransactionExecuted(input, (payload) => payload.type === "add_owner");
export const safeTransactionExecutedRemoveOwner = async (input: ConnectorInput) =>
  safeTransactionExecuted(input, (payload) => payload.type === "remove_owner");
export const safeTransactionExecutedOther = async (input: ConnectorInput) =>
  safeTransactionExecuted(input, (payload) => payload.type === "other");
