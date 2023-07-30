import axios from "axios";
import { ethers } from "ethers";
import { ITriggerInstance, TriggerInit } from "grindery-nexus-common-utils";
import { sanitizeParameters } from "../../../../../utils";
import * as evm from "../../../triggers";
import { API_BASE } from "../common";
import { NewEventInput } from "../../../../utils";

class DepositReceivedNative extends evm.NewEventTrigger {
  protected async processSignal(payload: Record<string, unknown>): Promise<boolean> {
    if (String(payload.value) === "0") {
      return false;
    }
    payload.valueFormatted = ethers.utils.formatUnits(payload.value as string, "ether");
    return true;
  }
}
export async function safeDepositReceivedNative(input: TriggerInit): Promise<ITriggerInstance> {
  const ret = new DepositReceivedNative(
    await sanitizeParameters({
      ...input,
      fields: {
        ...(input.fields as object),
        eventDeclaration: "SafeReceived(address indexed sender, uint256 value)",
        parameterFilters: {},
      } as NewEventInput,
    })
  );
  return ret;
}
class DepositReceivedERC20 extends evm.NewEventTrigger {
  protected async processSignal(payload: Record<string, unknown>): Promise<boolean> {
    if (String(payload.value) === "0") {
      return false;
    }
    const resp = await axios
      .get(
        `${API_BASE}v1/chains/${payload._grinderyChainId}/safes/${payload.to}/incoming-transfers/?to=${payload.to}&token_address=${payload._grinderyContractAddress}&value=${payload.value}&limit=1`
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
    return true;
  }
}
export async function safeDepositReceivedERC20(input: TriggerInit): Promise<ITriggerInstance> {
  input = await sanitizeParameters(input);
  const ret = new DepositReceivedERC20(
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
      } as unknown as NewEventInput,
    })
  );
  return ret;
}
