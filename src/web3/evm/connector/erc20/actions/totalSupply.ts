import { ActionOutput, ConnectorInput } from "grindery-nexus-common-utils";
import { callSmartContract } from "../../../call";
import { sanitizeParameters } from "../../../../../utils";
import { BigNumber } from "@ethersproject/bignumber";

export async function totalSupplyAction(input: ConnectorInput<unknown>): Promise<ActionOutput> {
  const fields = input.fields as {
    [key: string]: string;
  };

  const getTotalSupply = await callSmartContract(
    await sanitizeParameters({
      ...input,
      fields: {
        ...fields,
        functionDeclaration: "function totalSupply() view returns (uint256)",
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

  return {
    ...getTotalSupply,
    payload: {
      totalSupply: BigNumber.from(
        (
          getTotalSupply.payload as {
            returnValue: string;
          }
        ).returnValue
      )
        .div(
          BigNumber.from(10).pow(
            BigNumber.from(
              (
                getDecimals.payload as {
                  returnValue: string;
                }
              ).returnValue
            )
          )
        )
        .toString(),
    },
  };
}
