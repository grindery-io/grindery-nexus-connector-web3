import { ConnectorInput, TriggerBase } from "grindery-nexus-common-utils/dist/connector";
import { TAccessToken } from "../../jwt";
import { NewTransactionTrigger, NewEventTrigger } from "./triggers";
import { getUserAddress, HUB_ADDRESS } from "./utils";
import { getWeb3 } from "./web3";
import GrinderyNexusHub from "./abi/GrinderyNexusHub.json";

export { callSmartContract } from "./call";

export const Triggers = new Map<string, new (params: ConnectorInput) => TriggerBase>([
  ["newTransaction", NewTransactionTrigger],
  ["newTransactionAsset", NewTransactionTrigger],
  ["newEvent", NewEventTrigger],
]);

const droneAddressCache = new Map<string, string>();

export async function getUserDroneAddress(user: TAccessToken) {
  const userAddress = await getUserAddress(user);
  if (!droneAddressCache.has(userAddress)) {
    const { web3, close } = getWeb3("eip155:1");
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hubContract = new web3.eth.Contract(GrinderyNexusHub as any, HUB_ADDRESS);
      const droneAddress = await hubContract.methods.getUserDroneAddress(userAddress).call();
      droneAddressCache.set(userAddress, droneAddress);
    } finally {
      close();
    }
  }
  return droneAddressCache.get(userAddress) as string;
}
