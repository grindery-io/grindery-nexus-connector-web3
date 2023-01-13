import "dotenv/config";
export const CHAIN_MAPPING: { [key: string]: string | [string, string] } = {
  "eip155:1": "eth",
  "eip155:42161": "arbitrum",
  "eip155:100": "gnosis",
  "eip155:137": "polygon",
  "eip155:42220": "celo",
  "eip155:43114": "avalanche",
  "eip155:56": "bsc",
  "eip155:250": "fantom",
  "eip155:1666600000": "harmony",

  "eip155:80001": "polygon_mumbai",
  "eip155:5": [
    `wss://eth-goerli.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
    `https://eth-goerli.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  ],
  "eip155:97": "bsc_testnet_chapel",

  "eip155:25": [
    `wss://cro.getblock.io/mainnet/?api_key=${process.env.GETBLOCK_API_KEY}`,
    `https://cro.getblock.io/mainnet/?api_key=${process.env.GETBLOCK_API_KEY}`,
  ],
};
