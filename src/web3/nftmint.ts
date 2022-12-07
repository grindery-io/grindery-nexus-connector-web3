import _ from "lodash";
import {
  ConnectorInput,
  ConnectorOutput,
  TriggerBase,
} from "grindery-nexus-common-utils/dist/connector";
import { TAccessToken } from "../jwt";

import MintNFT from "./evm/abi/MintNFT.json";
import { getWeb3 } from "./evm/web3";
import { NewEventTrigger, NewTransactionTrigger } from "./evm/triggers";

export const Triggers = new Map<string, new (params: ConnectorInput) => TriggerBase>();
Triggers.set("newTransaction", NewTransactionTrigger);
Triggers.set("newEvent", NewEventTrigger);

export async function callSmartContract(
  input: ConnectorInput<{
    chain: string;
    contractAddress: string;
    functionDeclaration: string;
    parameters: { [key: string]: unknown };
    maxFeePerGas?: string | number;
    maxPriorityFeePerGas?: string | number;
    gasLimit?: string | number;
    dryRun?: boolean;
    userToken: string;
  }>
): Promise<ConnectorOutput> {
  const { web3, close } = getWeb3("eip155:5");
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contract = new web3.eth.Contract(MintNFT as any, input.fields.contractAddress);
    const tokenURI = {
      name: input.fields.parameters.name,
      description: input.fields.parameters.description,
      image: input.fields.parameters.image,
    };
    const transactionReceipt = await contract.methods.mintNFT(input.fields.parameters.recipient, tokenURI).call();
    return {
      key: input.key,
      sessionId: input.sessionId,
      payload: {
        transactionReceipt,
      },
    };
  } catch (err) {
    console.log(err);
    return err;
  } finally {
    close();
  }
}

export async function getUserDroneAddress(
  _user: TAccessToken
): Promise<string> {
  throw new Error("Not implemented");
}