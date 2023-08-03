import { ethers } from "ethers";

export const API_BASE = "https://safe-client.safe.global/";
function fillTransferInfo(payload: Record<string, unknown>, safeTxInfo) {
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
  }
  safeTxInfo.txInfo.sender = safeTxInfo.txInfo.sender?.value || safeTxInfo.txInfo.sender;
  safeTxInfo.txInfo.recipient = safeTxInfo.txInfo.recipient?.value || safeTxInfo.txInfo.recipient;
}
export function processSafeTxInfo(safeTxInfo, payload: Record<string, unknown>) {
  payload.safeTxInfo = safeTxInfo;
  if (safeTxInfo.detailedExecutionInfo) {
    Object.assign(payload, safeTxInfo.detailedExecutionInfo);
  }
  let type = "other";
  if (safeTxInfo.txInfo?.transferInfo) {
    fillTransferInfo(payload, safeTxInfo);
    type = `transfer_${safeTxInfo.txInfo.transferInfo.type?.toLowerCase() || "unknown"}`;
  }
  if (safeTxInfo.txInfo?.type === "SettingsChange") {
    type = safeTxInfo.txInfo.settingsInfo?.type?.toLowerCase() || "settings_change";
    if (safeTxInfo.txInfo.settingsInfo.owner) {
      safeTxInfo.txInfo.owner = safeTxInfo.txInfo.settingsInfo.owner.value || safeTxInfo.txInfo.settingsInfo.owner;
    }
  }
  Object.assign(payload, safeTxInfo.txInfo || {});
  return type;
}
