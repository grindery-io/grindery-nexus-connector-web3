import { ConnectorInput, ConnectorOutput } from "grindery-nexus-common-utils/dist/connector";
import * as nftnear from "./near/nftnear";
import * as txtestalgorand from "./algorand/txtestalgorand";
import * as nftalgorand from "./algorand/nftalgorand";
import { DepayActions } from "./utils";

const ACTIONS: {
  [key: string]: {
    SendTransactionAction(input: ConnectorInput<unknown>, depay: DepayActions<unknown>): Promise<ConnectorOutput>;
  };
} = {
  "near:testnet:NFTMint": nftnear,
  "near:mainnet:NFTMint": nftnear,
  "algorand:testnet:NFTMint": nftalgorand,
  "algorand:mainnet:NFTMint": nftalgorand,
  "algorand:testnet:txtest": txtestalgorand,
  "algorand:mainnet:txtest": txtestalgorand,
};

export function SendTransactionAction(
  input: ConnectorInput<{ chain: string; functionDeclaration: string }>,
  depay: DepayActions<unknown>
) {
  console.log("SendTransactionAction");
  console.log("module: " + input.key);

  return ACTIONS[input.fields.chain.concat(":" + input.fields.functionDeclaration)].SendTransactionAction(input, depay);
}
