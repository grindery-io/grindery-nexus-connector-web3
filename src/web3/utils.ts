import algosdk from "algosdk";
import { ITriggerInstance, TriggerInit } from "grindery-nexus-common-utils";

/**
 * Represents the input for creating a new transaction.
 * @property {string | string[]} chain - Blockchain(s) where the transaction will occur.
 * @property {string} from - Sender's address (optional).
 * @property {string} to - Recipient's address (optional).
 */
export type NewTransactionInput = { chain: string | string[]; from?: string; to?: string };

/**
 * Represents input parameters for creating a new event.
 * @property {string | string[]} chain - Blockchain network(s) to listen on.
 * @property {string} contractAddress - Smart contract's address (optional).
 * @property {string | string[]} eventDeclaration - Event name(s) to listen for.
 * @property parameterFilters - Key-value pairs for event parameter filters.
 */
export type NewEventInput = {
  chain: string | string[];
  contractAddress?: string;
  eventDeclaration: string | string[];
  parameterFilters: { [key: string]: unknown };
};

/**
 * Represents input for a new transaction flow.
 * @property {string} chain - Blockchain network for the transaction.
 * @property {string} contract - Smart contract's address.
 * @property {string} eventDeclaration - Event declaration to listen for.
 * @property {string} from - Sender's address (optional).
 * @property {string} to - Recipient's address (optional).
 */
export type NewTransactionFlowInput = {
  chain: string;
  contract: string;
  eventDeclaration: string;
  from?: string;
  to?: string;
};

/**
 * Represents a constructor function for creating trigger instances.
 * @template T - The type of input data for the trigger.
 * @param {TriggerInit<T>} input - Input data for initializing the trigger instance.
 * @returns {ITriggerInstance} - An instance of the trigger.
 */
export type TriggerConstructor<T = any> = new (input: TriggerInit<T>) => ITriggerInstance;

/**
 * Represents an object with fields of type `T`.
 * @property {T} fields - Fields or properties of an object.
 */
export type DepayActions<T = unknown> = {
  fields: T;
};

/**
 * Object with `grinderyAccount` and `userAccount` properties.
 * @property {any} grinderyAccount - Grindery account for token sending.
 * @property {any} userAccount - User's logged-in account.
 */
export type NearDepayActions = {
  grinderyAccount: any;
  userAccount: any;
};

/**
 * Object with functions and properties for Algorand transactions.
 * @property comp - AtomicTransactionComposer for creating transactions.
 * @property algodClient - Algorand client for sending transactions.
 * @property grinderyAccount - Account for transaction fees.
 * @property userAccount - Account for transaction fee payment.
 * @property {string} receiver - Address of fund recipient.
 */
export type AlgorandDepayActions = {
  comp: algosdk.AtomicTransactionComposer;
  algodClient: algosdk.Algodv2;
  grinderyAccount: algosdk.Account;
  userAccount: algosdk.Account;
  receiver: string;
};

/**
 * Retrieves the network ID from a chain identifier.
 * @param {string} chain - Chain identifier in various formats, e.g., "network:chain" or "network.chain".
 * @returns {Promise<string>} - The extracted network ID.
 * @throws {Error} - Throws an error if the chain identifier format is invalid.
 */
export async function getNetworkId(chain: string): Promise<string> {
  return chain.includes(":")
    ? chain.split(":")[1]
    : (() => {
        throw new Error("Invalid chain identifier format. Use 'network:chain' format.");
      })();
}
