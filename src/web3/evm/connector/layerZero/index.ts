import { ActionOutput, ConnectorInput } from "grindery-nexus-common-utils";
import { sanitizeParameters } from "../../../../utils";
import { callSmartContract } from "../../call";
import { CHAIN_MAPPING } from "../../chains";
import { getWeb3 } from "../../web3";

const CHAIN_IDS: { [key: string]: number } = {
  // https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids
  "eip155:1": 101,
  "eip155:42161": 110,
  "eip155:100": 145,
  "eip155:137": 109,
  "eip155:42220": 125,
  "eip155:43114": 106,
  "eip155:56": 102,
  "eip155:250": 112,
  "eip155:1666600000": 116,
  // "eip155:25": cro,
  "eip155:1101": 158,
  // "eip155:1284": moonbeam,

  // Testnets: https://layerzero.gitbook.io/docs/technical-reference/testnet/testnet-addresses
  "eip155:80001": 10109,
  "eip155:5": 10121,
  "eip155:11155111": 10161,
  "eip155:97": 10102,
  "eip155:4002": 10112,
  "eip155:1442": 10158,
  "eip155:44787": 10125,
  // "eip155:9000": evmost?,
};

type Fields = {
  _grinderyContractAddress: string;
  _grinderyChainSource: string;
  _grinderyChain: string;
  blockHash: string;
};

export async function layerZeroUpdateHash(input: ConnectorInput<unknown>): Promise<ActionOutput> {
  const fields = input.fields as Fields;
  const { _grinderyChainSource, _grinderyChain, blockHash } = fields;
  if (!CHAIN_IDS[_grinderyChainSource]) {
    throw new Error("Source chain is not supported");
  }
  if (!CHAIN_MAPPING[_grinderyChain]) {
    throw new Error("Destination chain is not supported");
  }
  const parameters = input.fields as { [key: string]: unknown };
  parameters._srcChainId = CHAIN_IDS[_grinderyChainSource];
  parameters._lookupHash = blockHash;
  const { web3, close } = getWeb3(_grinderyChainSource);
  try {
    const block = await web3.eth.getBlock(blockHash, false);
    if (!block) {
      throw new Error("Can't find block with specified hash");
    }
    const currentBlockNumber = await web3.eth.getBlockNumber();
    parameters._blockData = block.receiptsRoot;
    parameters._confirmations = currentBlockNumber - block.number;
  } finally {
    close();
  }
  return await callSmartContract(
    await sanitizeParameters({
      ...input,
      fields: {
        ...fields,
        chain: _grinderyChain,
        contractAddress: fields._grinderyContractAddress,
        functionDeclaration:
          "function updateHash(uint16 _srcChainId, bytes32 _lookupHash, uint _confirmations, bytes32 _blockData)",
        parameters,
      },
    })
  );
}
