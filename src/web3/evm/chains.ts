import "dotenv/config";

const ANKR = (name: string): [string, string] => [
  `wss://rpc.ankr.com/${name}/ws/${process.env.ANKR_KEY}`,
  `https://rpc.ankr.com/${name}/${process.env.ANKR_KEY}`,
];
const ALCHEMY = (name: string): [string, string] => [
  `wss://${name}.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  `https://${name}.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
];
const GETBLOCK = (name: string, netType: "mainnet" | "testnet" | string = "mainnet"): [string, string] => [
  `wss://${name}.getblock.io/${process.env.GETBLOCK_API_KEY}/${netType}/`,
  `https://${name}.getblock.io/${process.env.GETBLOCK_API_KEY}/${netType}/`,
];
const LAVANET = (wsPath: string, httpsPath: string): [string, string] => [
  `wss://g.w.lavanet.xyz:443/gateway/${wsPath}/${process.env.LAVANET_API_KEY}`,
  `https://g.w.lavanet.xyz:443/gateway/${httpsPath}/${process.env.LAVANET_API_KEY}`,
];
const CHAINSTACK = (nodeId: string): [string, string] => [
  `wss://ws-${nodeId}.p2pify.com/${process.env.CHAINSTACK_API_KEY}`,
  `https://${nodeId}.p2pify.com/${process.env.CHAINSTACK_API_KEY}`,
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
  "eip155:97": GETBLOCK("bsc", "testnet"),
  "eip155:4002": ANKR("fantom_testnet"),
  "eip155:1442": ANKR("polygon_zkevm_testnet"),
  "eip155:338": CHAINSTACK("nd-326-373-985"), // Cronos testnet
  "eip155:44787": LAVANET("alfajores/rpc", "alfajores/rpc-http"),
  "eip155:9000": LAVANET("evmost/json-rpc", "evmost/json-rpc-http"),
};
