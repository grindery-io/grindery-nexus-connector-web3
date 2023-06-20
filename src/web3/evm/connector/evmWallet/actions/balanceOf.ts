import { ConnectorInput, ConnectorOutput } from "grindery-nexus-common-utils";
import { getWeb3 } from "../../../web3";
import { parseUserAccessToken } from "../../../../../jwt";

export async function getBalanceNative(input: ConnectorInput<unknown>): Promise<ConnectorOutput> {
  const fields = input.fields as {
    [key: string]: string | { address: string };
  };

  if (!(fields as { [key: string]: string })._grinderyUserToken) {
    console.warn("_grinderyUserToken is not available");
  }
  const user = await parseUserAccessToken(
    (fields as { [key: string]: string })._grinderyUserToken || (fields as { [key: string]: string }).userToken || ""
  ).catch(() => null);
  if (!user) {
    throw new Error("User token is invalid");
  }

  const { web3 } = getWeb3((fields as { [key: string]: string }).chain);

  return {
    key: input.key,
    sessionId: input.sessionId,
    payload: {
      balance: await web3.eth
        .getBalance(
          (
            fields.parameters as {
              address: string;
            }
          ).address
        )
        .then((result) => web3.utils.fromWei(result)),
    },
  };
}
