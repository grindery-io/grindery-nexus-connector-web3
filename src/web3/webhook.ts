import { ConnectorInput, WebhookOutput, WebhookParams } from "grindery-nexus-common-utils/dist/connector";
import * as evm from "./evm";
import { parseUserAccessToken } from "../jwt";
import { CHAINS } from "./index";
import { createAccount } from "./flow";

const WEBHOOK_FUNCTIONS = {
  async getDroneAddress(params: ConnectorInput<WebhookParams>) {
    const { token, chain } = (params.fields.payload || {}) as { token: string; chain: string };
    if (!token || !chain) {
      throw new Error("Missing parameter");
    }
    const user = await parseUserAccessToken(token).catch(() => null);
    if (!user) {
      throw new Error("Invalid access token");
    }
    let droneAddress: string;
    if (CHAINS[chain]) {
      droneAddress = await CHAINS[chain].getUserDroneAddress(user);
    } else {
      if (!/^eip155:\d+$/.exec(chain)) {
        throw new Error("Invalid chain");
      }
      droneAddress = await evm.getUserDroneAddress(user);
    }
    return { droneAddress };
  },
  async flowCreateAccount(_params: ConnectorInput<WebhookParams>) {
    return await createAccount();
  },
  async echo(params: ConnectorInput<WebhookParams>) {
    return params.fields.payload;
  },
};

export async function callSmartContractWebHook(params: ConnectorInput<WebhookParams>): Promise<WebhookOutput> {
  if (params.fields.method !== "POST") {
    throw new Error("Unsupported method");
  }
  if (!WEBHOOK_FUNCTIONS[params.fields.path]) {
    throw new Error("Unsupported call");
  }
  return { payload: await WEBHOOK_FUNCTIONS[params.fields.path](params), returnUnwrapped: true };
}
