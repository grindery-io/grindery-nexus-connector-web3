import { ActionOutput, ConnectorInput } from "grindery-nexus-common-utils";
import { callSmartContract } from "../../../call";
import { sanitizeParameters } from "../../../../../utils";
import { ethers } from "ethers";

export async function InformationInvestmentClub(input: ConnectorInput<unknown>): Promise<ActionOutput> {
  const fields = input.fields as {
    [key: string]: string;
  };

  const getOwner = await callSmartContract(
    await sanitizeParameters({
      ...input,
      fields: {
        ...(fields as any),
        functionDeclaration: "function owner() view returns (address)",
        parameters: {},
      },
    })
  );

  const getName = await callSmartContract(
    await sanitizeParameters({
      ...input,
      fields: {
        ...(fields as any),
        functionDeclaration: "function name() view returns (string)",
        parameters: {},
      },
    })
  );

  const getSymbol = await callSmartContract(
    await sanitizeParameters({
      ...input,
      fields: {
        ...(fields as any),
        functionDeclaration: "function symbol() view returns (string)",
        parameters: {},
      },
    })
  );

  const getTotalSupply = await callSmartContract(
    await sanitizeParameters({
      ...input,
      fields: {
        ...(fields as any),
        functionDeclaration: "function totalSupply() view returns (uint256)",
        parameters: {},
      },
    })
  );

  return {
    ...getTotalSupply,
    payload: {
      owner: (
        getOwner.payload as {
          returnValue: string;
        }
      ).returnValue,
      name: (
        getName.payload as {
          returnValue: string;
        }
      ).returnValue,
      symbol: (
        getSymbol.payload as {
          returnValue: string;
        }
      ).returnValue,
      totalSupply: ethers.utils.formatEther(
        (
          getTotalSupply.payload as {
            returnValue: string;
          }
        ).returnValue
      ),
    },
  };
}
