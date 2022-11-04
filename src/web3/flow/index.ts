import { ConnectorInput, ConnectorOutput } from "grindery-nexus-common-utils/dist/connector";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import { sendTransaction, createAccount as _createAccount } from "./send";
import { TAccessToken } from "../../jwt";

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
    signerArgs: {
      accountAddress: privateKeyParts[0],
      keyId: parseInt(privateKeyParts[1], 10),
      pkey: privateKeyParts[2],
    },
  });
  return { key: input.key, sessionId: input.sessionId, payload: result };
}

export async function createAccount(): Promise<unknown> {
  const privateKeyParts = process.env.FLOW_KEY?.split("/");
  if (privateKeyParts?.length !== 3) {
    throw new Error("Invalid flow key");
  }

  return await _createAccount({
    signerArgs: {
      accountAddress: privateKeyParts[0],
      keyId: parseInt(privateKeyParts[1], 10),
      pkey: privateKeyParts[2],
    },
  });
}

export async function getUserDroneAddress(_user: TAccessToken): Promise<string> {
  throw new Error("Not implemented");
}
