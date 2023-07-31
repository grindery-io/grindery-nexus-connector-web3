import { ActionOutput, ConnectorInput } from "grindery-nexus-common-utils";
import { callSmartContract } from "../../../call";
import { sanitizeParameters } from "../../../../../utils";
import { BigNumber } from "@ethersproject/bignumber";

export async function allowanceAction(input: ConnectorInput<unknown>): Promise<ActionOutput> {
  const fields = input.fields as {
    [key: string]: string;
  };

  const getAllowance = await callSmartContract(
    await sanitizeParameters({
      ...input,
      fields: {
        ...(fields as any),
        functionDeclaration: "function allowance(address owner, address spender) view returns (uint256)",
      },
    })
  );

  const getDecimals = await callSmartContract(
    await sanitizeParameters({
      ...input,
      fields: {
        ...(fields as any),
        functionDeclaration: "function decimals() view returns (uint256)",
        parameters: {},
      },
    })
  );

  return {
    ...getAllowance,
    payload: {
      allowance: BigNumber.from(
        (
          getAllowance.payload as {
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
