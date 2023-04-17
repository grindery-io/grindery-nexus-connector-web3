import "dotenv/config";

const ANKR = (name: string): [string, string] => [
  `wss://rpc.ankr.com/${name}/${process.env.ANKR_KEY}`,
  `https://rpc.ankr.com/${name}/ws/${process.env.ANKR_KEY}`,
];
const ALCHEMY = (name: string): [string, string] => [
  `wss://${name}.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  `https://${name}.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
];
const GETBLOCK = (name: string, netType: "mainnet" = "mainnet"): [string, string] => [
  `wss://${name}.getblock.io/${netType}/?api_key=${process.env.GETBLOCK_API_KEY}`,
  `https://${name}.getblock.io/${netType}/?api_key=${process.env.GETBLOCK_API_KEY}`,
];

export const CHAIN_MAPPING: { [key: string]: [string, string] } = {
  "eip155:1": ANKR("eth"),
  "eip155:42161": ANKR("arbitrum"),
  "eip155:100": ANKR("gnosis"),
  "eip155:137": ANKR("polygon"),
  "eip155:42220": ANKR("celo"),
  "eip155:43114": ANKR("avalanche"),
  "eip155:56": ANKR("bsc"),
  "eip155:250": ANKR("fantom"),
  "eip155:1666600000": ANKR("harmony"),
  "eip155:25": GETBLOCK("cro"),
  "eip155:1101": ANKR("polygon_zkevm"),
  "eip155:1284": ANKR("moonbeam"),

  // Testnets
  "eip155:80001": ANKR("polygon_mumbai"),
  "eip155:5": ALCHEMY("eth-goerli"),
  "eip155:11155111": ANKR("eth_sepolia"),
  "eip155:97": ANKR("bsc_testnet_chapel"),
  "eip155:4002": ANKR("fantom_testnet"),
  "eip155:1442": ANKR("polygon_zkevm_testnet"),
};
