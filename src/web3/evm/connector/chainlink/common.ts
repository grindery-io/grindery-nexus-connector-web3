import { InputProviderOutput } from "grindery-nexus-common-utils";
import { FieldSchema, FieldChoiceSchema } from "grindery-nexus-common-utils/dist/types";
import axios from "axios";

export type clkFields = {
  _grinderyChain: string;
  _getChainlinkPriceFeed?: string;
};

/* A mapping of the chain ID to the feed name. */
const CHAINS_MAPPING_CHAINLINK_PRICE_FEEDS: { [key: string]: string } = {
  "eip155:1": "mainnet",
  "eip155:42161": "ethereum-mainnet-arbitrum-1",
  "eip155:100": "xdai-mainnet",
  "eip155:137": "matic-mainnet",
  "eip155:42220": "",
  "eip155:43114": "avalanche-mainnet",
  "eip155:56": "bsc-mainnet",
  "eip155:250": "fantom-mainnet",
  "eip155:1666600000": "harmony-mainnet-0",
  "eip155:80001": "matic-testnet",
  "eip155:5": "goerli",
  "eip155:97": "bsc-testnet",
  "eip155:25": "",
};

/**
 * It takes a feed name as a parameter, makes a request to the reference-data-directory API, and
 * returns an array of objects with the name, proxy address, and sample of each pair
 * @param {string} feed - The name of the feed you want to get the pairs from.
 * @returns An array of objects with the following properties:
 * - value: string
 * - label: string
 * - sample: string
 */
async function getPairs(feed: string): Promise<FieldChoiceSchema[]> {
  const pairsArray = [] as FieldChoiceSchema[];
  try {
    const res = await axios.get(`https://reference-data-directory.vercel.app/feeds-${feed}.json`);
    res.data.map((item) => {
      if (item.feedCategory === "verified" || !item.feedCategory) {
        pairsArray.push({
          value: item.name.concat(" - ", item.proxyAddress),
          label: item.name,
          sample: item.name,
        });
      }
      return null;
    });
    return pairsArray;
  } catch (err) {
    throw new Error(err);
  }
}

/**
 * It takes a string, finds the first occurrence of "0x", then finds the first occurrence of a space
 * after that, and returns the substring between those two points
 * @param {string} [input] - The string to extract the address from.
 * @returns A string
 */
export async function extractAddressFromPair(input?: string): Promise<string> {
  if (!input) {
    return "";
  }
  const hexStart = input.indexOf("0x");
  if (hexStart === -1) {
    return "";
  }
  const hexEnd = input.indexOf(" ", hexStart);
  if (hexEnd === -1) {
    return input.substring(hexStart);
  }
  return input.substring(hexStart, hexEnd);
}

/**
 * It takes in a fieldData object and returns an object with an inputFields array
 * @param {CommonFields} fieldData - CommonFields
 * @returns an object of type InputProviderOutput.
 */
export async function prepareOutputChainlink(fieldData: clkFields): Promise<InputProviderOutput> {
  /* Creating a new object called ret and assigning it the type InputProviderOutput. */
  const ret: InputProviderOutput = {
    inputFields: [
      {
        key: "_grinderyChain",
        required: true,
        type: "string",
        label: "Blockchain",
      },
    ],
  };
  /* Checking if the fieldData object has a property called _grinderyChain. If it does, it will add a
    new field to the inputFields array. */
  if (fieldData?._grinderyChain) {
    ret.inputFields.push({
      key: "_getChainlinkPriceFeed",
      label: "Chainlink Price Feed",
      type: "string",
      required: true,
      placeholder: "Select a pair",
      choices: await getPairs(CHAINS_MAPPING_CHAINLINK_PRICE_FEEDS[fieldData._grinderyChain]),
    } as FieldSchema);
  }
  return ret;
}
