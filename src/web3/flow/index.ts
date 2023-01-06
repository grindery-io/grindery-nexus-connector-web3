import { ConnectorInput, ConnectorOutput } from "grindery-nexus-common-utils/dist/connector";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import { sendTransaction, createAccount as _createAccount } from "./send";
import { TAccessToken } from "../../jwt";
import axios from "axios";

export * from "./triggers";

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
  }>
): Promise<ConnectorOutput> {
  let addressResp;
  try {
    addressResp = await axios.post(
      (process.env.CREDENTIAL_MANAGER_REQUEST_PREFIX || "").replace("$CDS_NAME", "flow") +
        "grindery-nexus-orchestrator:3000/webhook/web3/callSmartContract/echo",
      { address: "{{ auth.address }}" },
      {
        headers: {
          Authorization: `Bearer ${input.authentication}`,
          "Content-Type": "application/json",
          "x-grindery-template-scope": "all",
        },
      }
    );
  } catch (e) {
    console.error("[Flow] Failed to decode address", { status: e.response?.status, data: e.response?.data });
    throw e;
  }
  const address = addressResp.data.address;
  if (!address) {
    throw new Error("Can't get address from authentication token");
  }
  const m = /^\[([^\]]+?)\](.+)$/.exec(input.fields.functionDeclaration);
  if (!m) {
    throw new InvalidParamsError("Invalid function declaration");
  }
  let cadence;
  try {
    cadence = Buffer.from(m[2], "base64").toString("utf-8");
  } catch (e) {
    throw new InvalidParamsError("Invalid function declaration (invalid script)");
  }
  const args = [] as [unknown, string][];
  const rawParams = m[1].split(/, */);
  for (const rawParam of rawParams) {
    const pair = rawParam.split(":").map((x) => x.trim());
    if (pair.length !== 2) {
      throw new InvalidParamsError("Invalid function declaration (invalid parameter declaration)");
    }
    const [name, type] = pair;
    if (!(name in input.fields.parameters)) {
      throw new Error("Missing parameter: " + name);
    }
    args.push([input.fields.parameters[name], type]);
  }
  const privateKeyParts = process.env.FLOW_KEY?.split("/");
  if (privateKeyParts?.length !== 3) {
    throw new Error("Invalid flow key");
  }
  const result = await sendTransaction({
    cadence,
    args,
    senderArgs: {
      accountAddress: address,
      keyId: 0,
      pkey: privateKeyParts[2],
    },
    payerArgs: {
      accountAddress: privateKeyParts[0],
      keyId: parseInt(privateKeyParts[1], 10),
      pkey: privateKeyParts[2],
    },
  });
  return { key: input.key, sessionId: input.sessionId, payload: result };
}

export async function createAccount() {
  const privateKeyParts = process.env.FLOW_KEY?.split("/");
  if (privateKeyParts?.length !== 3) {
    throw new Error("Invalid flow key");
  }

  return await _createAccount({
    senderArgs: {
      accountAddress: privateKeyParts[0],
      keyId: parseInt(privateKeyParts[1], 10),
      pkey: privateKeyParts[2],
    },
  });
}

export async function getUserDroneAddress(_user: TAccessToken): Promise<string> {
  throw new Error("Not implemented");
}


import * as fcl from "@onflow/fcl";

fcl
  .config()
  .put("accessNode.api", "https://rest-mainnet.onflow.org")
  .put("0xFlowToken", "0xd01e482eb680ec9f");

async function myScript() {


  const result = await fcl.query({
    cadence: `
      import REVV from 0xd01e482eb680ec9f
      import FungibleToken from 0xf233dcee88fe0abe
      import FungibleTokenMetadataViews from 0xf233dcee88fe0abe
      import MetadataViews from 0x1d7e57aa55817448

      // pub fun main(): UFix64 {

      //   let address: Address = 0x4fa00e027b16f8e7
      //   let account = getAccount(address)

      //   let vaultRef = account
      //   .getCapability(REVV.RevvBalancePublicPath)
      //   .borrow<&{FungibleToken.Balance}>()
      //   ?? panic("Could not borrow a reference to the collection")

      //   return vaultRef.balance
      // }


      pub fun main(): FungibleTokenMetadataViews.FTView{

        let address: Address = 0x4fa00e027b16f8e7
        let account = getAccount(address)

        let vaultRef = account
        .getCapability(REVV.RevvBalancePublicPath)
        .borrow<&{MetadataViews.Resolver}>()
        ?? panic("Could not borrow a reference to the vault resolver")

        let ftView = FungibleTokenMetadataViews.getFTView(viewResolver: vaultRef)

        return ftView
      }
    `
  });

  const status = await fcl
  .send([
    fcl.getTransactionStatus(
      "9dda5f281897389b99f103a1c6b180eec9dac870de846449a302103ce38453f3"
    ),
  ])
  .then(fcl.decode);

  const account = await fcl.account("0xd01e482eb680ec9f");


  console.log(await result);
}

// myScript();
