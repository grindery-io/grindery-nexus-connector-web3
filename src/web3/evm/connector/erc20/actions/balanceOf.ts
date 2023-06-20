import { ActionOutput, ConnectorInput } from "grindery-nexus-common-utils";
import { callSmartContract } from "../../../call";
import { sanitizeParameters } from "../../../../../utils";
import { BigNumber } from "@ethersproject/bignumber";

export async function balanceOfActionERC20(input: ConnectorInput<unknown>): Promise<ActionOutput> {
  const fields = input.fields as {
    [key: string]: string | { address: string };
  };

  const getBalance = await callSmartContract(
    await sanitizeParameters({
      ...input,
      fields: {
        ...fields,
        functionDeclaration: "function balanceOf(address account) view returns (uint256)",
        parameters: {
          account: (
            fields.parameters as {
              address: string;
            }
          ).address,
        },
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
    ...getBalance,
    payload: {
      ...(getBalance.payload as object),
      returnValue: BigNumber.from(
        (
          getBalance.payload as {
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
