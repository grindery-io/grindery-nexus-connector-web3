import { TAccessToken } from "../../jwt";
import { NewTransactionTrigger, NewEventTrigger } from "./triggers";
import { getUserAddress, HUB_ADDRESS } from "./utils";
import { getWeb3 } from "./web3";
import GrinderyNexusHub from "./abi/GrinderyNexusHub.json";
import { AbiItem } from "web3-utils";
import { TriggerConstructor } from "../utils";

export { callSmartContract } from "./call";

export const Triggers = new Map<string, TriggerConstructor>([
  ["newTransaction", NewTransactionTrigger],
  ["newTransactionAsset", NewTransactionTrigger],
  ["newEvent", NewEventTrigger],
]);

export const droneAddressCache = new Map<string, string>();

/**
 * Retrieves the drone address associated with a user.
 *
 * @param user - The user's access token.
 * @returns The drone address associated with the user.
 */
export async function getUserDroneAddress(user: TAccessToken): Promise<string> {
  const userAddress = await getUserAddress(user);
  if (!droneAddressCache.has(userAddress)) {
    const { web3, close } = getWeb3("eip155:1");
    try {
      droneAddressCache.set(
        userAddress,
        await new web3.eth.Contract(GrinderyNexusHub as AbiItem[], HUB_ADDRESS).methods
          .getUserDroneAddress(userAddress)
          .call()
      );
    } finally {
      close();
    }
  }
  return droneAddressCache.get(userAddress) as string;
}
