import { ActionOutput, ConnectorInput } from "grindery-nexus-common-utils";
import { callSmartContract } from "../../../call";
import { sanitizeParameters } from "../../../../../utils";

export async function InformationERC20TokenAction(input: ConnectorInput<unknown>): Promise<ActionOutput> {
  const fields = input.fields as {
    [key: string]: string;
  };

  const getSymbol = await callSmartContract(
    await sanitizeParameters({
      ...input,
      fields: {
        ...fields,
        functionDeclaration: "function symbol() view returns (string)",
        parameters: {},
      },
    })
  );

  const getDecimals = await callSmartContract(
    await sanitizeParameters({
      ...input,
      fields: {
        ...fields,
        functionDeclaration: "function decimals() view returns (uint256)",
        parameters: {},
      },
    })
  );

  const getName = await callSmartContract(
    await sanitizeParameters({
      ...input,
      fields: {
        ...fields,
        functionDeclaration: "function name() view returns (string)",
        parameters: {},
      },
    })
  );

  return {
    ...getName,
    payload: {
      symbol: (
        getSymbol.payload as {
          returnValue: string;
        }
      ).returnValue,
      name: (
        getName.payload as {
          returnValue: string;
        }
      ).returnValue,
      decimals: (
        getDecimals.payload as {
          returnValue: string;
        }
      ).returnValue,
    },
  };
}
