import Web3 from "web3";
import { ConnectorInput, ConnectorOutput, TriggerBase } from "./connectorCommon";
import { AbiItem } from "web3-utils";

const CHAIN_MAPPING = {
  "eip155:1": "eth",
  "eip155:42161": "arbitrum",
  "eip155:100": "gnosis",
  "eip155:137": "polygon",
  "eip155:42220": "celo",
  "eip155:43114": "avalanche",
  "eip155:56": "bsc",
  "eip155:250": "fantom",
  "eip155:245022934": "solana",

  "eip155:80001": "wss://rpc-mumbai.matic.today/", // Polygon Mumbai testnet
};

function getWeb3(chain = "eth") {
  const url = CHAIN_MAPPING[chain]?.includes("://")
    ? CHAIN_MAPPING[chain]
    : `wss://rpc.ankr.com/${CHAIN_MAPPING[chain] || chain}/ws/${process.env.ANKR_KEY}`;
  const provider = new Web3.providers.WebsocketProvider(url, {
    reconnect: {
      auto: true,
      delay: 1000,
      onTimeout: true,
    },
  });
  const web3 = new Web3(provider);
  return {
    web3,
    close: () => {
      web3.setProvider(null);
      provider.reset();
      provider.disconnect();
    },
  };
}
function isSameAddress(a, b) {
  if (!a || !b) {
    return false;
  }
  if (/^0x/.test(a) && /^0x/.test(b)) {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}
function parseEventDeclaration(eventDeclaration: string): AbiItem {
  const m = /^\s*(event +)?([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*;?\s*$/.exec(eventDeclaration);
  if (!m) {
    throw new Error("Invalid event declaration");
  }
  const name = m[2];
  const inputs = m[3].split(",").map((p) => {
    const parts = p.trim().split(/\s+/);
    if (parts.length !== 2 && parts.length !== 3) {
      throw new Error("Invalid event declaration: Invalid parameter " + p);
    }
    if (parts.length === 3 && parts[1] !== "indexed") {
      throw new Error("Invalid event declaration: Invalid parameter " + p);
    }
    return {
      indexed: parts.length === 3,
      type: parts[0],
      name: parts[parts.length - 1],
    };
  });
  return {
    name,
    inputs,
    type: "event",
    anonymous: false,
  };
}
function parseFunctionDeclaration(functionDeclaration: string): AbiItem {
  const m = /^\s*(function +)?([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*(.*)$/.exec(functionDeclaration);
  if (!m) {
    throw new Error("Invalid function declaration");
  }
  const name = m[2];
  const inputs = m[3].split(",").map((p) => {
    const parts = p.trim().split(/\s+/);
    if (parts.length < 2) {
      throw new Error("Invalid function declaration: Invalid parameter " + p);
    }
    return {
      type: parts[0],
      name: parts[parts.length - 1],
    };
  });
  const suffixes = m[4].trim().split(/\s+/);
  return {
    name,
    inputs,
    constant: suffixes.includes("view"),
    payable: suffixes.includes("payable"),
    stateMutability: suffixes.includes("pure")
      ? "pure"
      : suffixes.includes("view")
      ? "view"
      : suffixes.includes("payable")
      ? "payable"
      : "nonpayable",
    type: "function",
  };
}

export class NewTransactionTrigger extends TriggerBase<{ chain: string; from?: string; to?: string }> {
  async main() {
    const { web3, close } = getWeb3(this.fields.chain);
    const subscription = web3.eth
      .subscribe("newBlockHeaders")
      .on("data", async (block) => {
        const blockWithTransactions = await web3.eth.getBlock(block.hash, true);
        for (const transaction of blockWithTransactions.transactions) {
          if (this.fields.from && !isSameAddress(transaction.from, this.fields.from)) {
            continue;
          }
          if (this.fields.to && !isSameAddress(transaction.to, this.fields.to)) {
            continue;
          }
          await this.sendNotification(transaction);
        }
      })
      .on("error", (error) => {
        console.error(error);
      });
    await this.waitForStop();
    await subscription.unsubscribe();
    close();
  }
}
export class NewEventTrigger extends TriggerBase<{
  chain: string;
  contractAddress: string;
  eventDeclaration: string;
  parameterFilters: { [key: string]: unknown };
}> {
  async main() {
    const { web3, close } = getWeb3(this.fields.chain);
    const eventInfo = parseEventDeclaration(this.fields.eventDeclaration);
    const topics = [web3.eth.abi.encodeEventSignature(eventInfo)] as (string | null)[];
    const inputs = eventInfo.inputs || [];
    for (const input of inputs) {
      if (input.indexed) {
        const value = this.fields.parameterFilters[input.name];
        topics.push(
          input.name in this.fields.parameterFilters ? web3.eth.abi.encodeParameter(input.type, value) : null
        );
      }
    }
    const subscription = web3.eth
      .subscribe("logs", {
        address: this.fields.contractAddress,
        topics,
      })
      .on("data", async (logEntry) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((logEntry as any).removed) {
          return;
        }
        const decoded = web3.eth.abi.decodeLog(inputs, logEntry.data, logEntry.topics.slice(1));
        const event = {} as { [key: string]: unknown };
        for (const input of inputs) {
          const name = input.name;
          if (!(name in this.fields.parameterFilters)) {
            continue;
          }
          if (
            web3.eth.abi.encodeParameter(input.type, decoded[name]) !==
            web3.eth.abi.encodeParameter(input.type, this.fields.parameterFilters[name])
          ) {
            return;
          }
          event[name] = decoded[name];
        }
        await this.sendNotification({
          _rawEvent: logEntry,
          ...event,
        });
      })
      .on("error", (error) => {
        console.error(error);
      });
    await this.waitForStop();
    await subscription.unsubscribe();
    close();
  }
}

export async function callSmartContract(
  input: ConnectorInput<{
    chain: string;
    contractAddress: string;
    functionDeclaration: string;
    parameters: { [key: string]: unknown };
    maxFeePerGas?: string | number;
    maxPriorityFeePerGas?: string | number;
  }>
): Promise<ConnectorOutput> {
  const { web3, close } = getWeb3(input.fields.chain);
  web3.eth.transactionConfirmationBlocks = 1;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const account = web3.eth.accounts.privateKeyToAccount(process.env.WEB3_PRIVATE_KEY!);
  web3.eth.accounts.wallet.add(account);
  web3.eth.defaultAccount = account.address;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paramArray = [] as any[];
  const functionInfo = parseFunctionDeclaration(input.fields.functionDeclaration);
  const inputs = functionInfo.inputs || [];
  for (const i of inputs) {
    if (!(i.name in input.fields.parameters)) {
      throw new Error("Missing parameter " + i.name);
    }
    paramArray.push(input.fields.parameters[i.name]);
  }
  const callData = web3.eth.abi.encodeFunctionCall(functionInfo, paramArray);
  const txConfig = {
    from: account.address,
    to: input.fields.contractAddress,
    data: callData,
    ...(input.fields.maxFeePerGas ? { maxFeePerGas: input.fields.maxFeePerGas } : {}),
    ...(input.fields.maxPriorityFeePerGas ? { maxPriorityFeePerGas: input.fields.maxPriorityFeePerGas } : {}),
    chainId: await web3.eth.getChainId(),
  };
  let result: unknown;
  if (functionInfo.constant || functionInfo.stateMutability === "pure") {
    result = {
      returnValue: await web3.eth.call(txConfig),
    };
  } else {
    result = await web3.eth.sendTransaction(txConfig);
  }

  close();
  return {
    key: input.key,
    sessionId: input.sessionId,
    payload: result,
  };
}
