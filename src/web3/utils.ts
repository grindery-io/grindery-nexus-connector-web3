import algosdk from "algosdk";

export async function getNetworkId(chain: string): Promise<string> {
  return chain.split(":")[1];
}

export type DepayActions<T = unknown> = {
  fields: T;
};

/**
 * `NearDepayActions` is an object with two properties, `grinderyAccount` and `userAccount`, both of
 * which are of type `any`.
 * @property {any} grinderyAccount - The grindery account that will be used to send the tokens.
 * @property {any} userAccount - The account that the user is currently logged in as.
 */
export type NearDepayActions = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  grinderyAccount: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userAccount: any;
};

/**
 * It's an object with four properties, each of which is a function that takes no arguments and returns
 * nothing.
 * @property comp - The AtomicTransactionComposer object that will be used to create the transaction.
 * @property algodClient - The Algorand client that will be used to send the transaction.
 * @property grinderyAccount - The account that will be used to pay for the transaction fees.
 * @property userAccount - The account that will be used to pay the transaction fee.
 * @property {string} receiver - The address of the user who will receive the funds.
 */
export type AlgorandDepayActions = {
  comp: algosdk.AtomicTransactionComposer;
  algodClient: algosdk.Algodv2;
  grinderyAccount: algosdk.Account;
  userAccount: algosdk.Account;
  receiver: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isJson(item: any): boolean {
  item = typeof item !== "string" ? JSON.stringify(item) : item;
  try {
    item = JSON.parse(item);
  } catch (e) {
    return false;
  }

  return typeof item === "object" && item !== null;
}
