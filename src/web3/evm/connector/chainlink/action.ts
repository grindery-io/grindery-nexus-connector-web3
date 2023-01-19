import {
  ConnectorInput,
  ActionOutput,
  InputProviderInput,
  InputProviderOutput
} from "grindery-nexus-common-utils";
import { callSmartContract } from "../../call";
import { sanitizeParameters } from "../../../../utils";
import {
  prepareOutputChainlink,
  clkFields,
  extractAddressFromPair
} from "./common";
import BigNumber from "bignumber.js";

/**
 * It takes the input from the previous step, and returns the input for the next step
 * @param params - InputProviderInput<unknown>
 * @returns The return value is a JSON object that contains the following fields:
 */
export async function clkPriceFeedActionInputProvider(params: InputProviderInput<unknown>): Promise<InputProviderOutput> {
  return await prepareOutputChainlink(
    params.fieldData as clkFields
  );
}

/**
 * It calls the smart contract to get the latest round data and converts the exchange rate from the
 * smart contract to a human readable format
 * @param input - The input object that is passed to the action.
 * @returns The exchange rate of the token.
 */
export async function clkPriceFeedAction(input: ConnectorInput<unknown>): Promise<ActionOutput> {
  const fields = input.fields as clkFields;
  const contractAddr = await extractAddressFromPair(fields._getChainlinkPriceFeed);
  /* Calling the smart contract to get the decimals of the token. */
  const getDecimals = await callSmartContract(await sanitizeParameters({
    ...input,
    fields: {
      ...fields,
      chain: fields._grinderyChain,
      contractAddress: contractAddr,
      functionDeclaration: "function decimals() view returns (uint8)",
      parameters: {},
    },
  }));
  const decimals = new BigNumber((getDecimals.payload as any).returnValue);
  /* Getting the pair from the smart contract. */
  const getPair = await callSmartContract(await sanitizeParameters({
    ...input,
    fields: {
      ...fields,
      chain: fields._grinderyChain,
      contractAddress: contractAddr,
      functionDeclaration: "function description() view returns (string)",
      parameters: {},
    },
  }));
  /* Calling the smart contract to get the latest round data. */
  const res = await callSmartContract(
    await sanitizeParameters({
      ...input,
      fields: {
        ...fields,
        chain: fields._grinderyChain,
        contractAddress: contractAddr,
        functionDeclaration: "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
        parameters: {},
      },
    })
  );
  /* Converting the exchange rate from the smart contract to a human readable format. */
  res.payload = {
    _exchangeRate: new BigNumber(
      (res.payload as any).returnValue.return1
    ).div(
      new BigNumber(10).pow(decimals)
    ).toString(),
    _pair: (getPair.payload as any).returnValue,
    _contractAddress: contractAddr
  };
  return res;
}


// clkPriceFeedActionInputProvider({
//   key: "clkPriceFeedAction",
//   fieldData: {
//   }
// });

// clkPriceFeedActionInputProvider({
//   key: "clkPriceFeedAction",
//   fieldData: {
//     _grinderyChain: "eip155:5"
//   }
// });

// clkPriceFeedAction({
//   key: "clkPriceFeedAction",
//   fields: {
//     _grinderyChain: "eip155:5",
//     _getChainlinkPriceFeed: "BTC / ETH - 0x779877A7B0D9E8603169DdbD7836e478b4624789",
//     userToken: "eyJhbGciOiJFUzI1NiJ9.eyJhdWQiOiJ1cm46Z3JpbmRlcnk6YWNjZXNzLXRva2VuOnYxIiwic3ViIjoiZWlwMTU1OjE6MHhCMjAxZkRkOTBiMTRjYzkzMGJFYzJjNEU5ZjQzMmJDMUNBNUFkN0M1IiwiaWF0IjoxNjc0MTYxMDIxLCJpc3MiOiJ1cm46Z3JpbmRlcnk6b3JjaGVzdHJhdG9yIiwiZXhwIjoxNjc0MTY0NjIxfQ.vOed-8w4tMp96zmhUzzzdpPKW9_HEMhcWZ-EQkMcWKL9cx_xHYRiKckZqE01F3C4cs_SdJRT9JSTJa50UYy9Ag"
//   },
//   sessionId: "1"
// });
