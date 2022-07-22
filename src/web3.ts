import Web3 from "web3";
import { ConnectorInput, ConnectorOutput, TriggerBase } from "./connectorCommon";
import { AbiItem } from "web3-utils";
import { TransactionConfig, Log } from "web3-core";
import { Subscription } from "web3-core-subscriptions";
import { BlockTransactionObject } from "web3-eth";
import { InvalidParamsError } from "./jsonrpc";
import { EventEmitter } from "node:events";

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

class Web3Wrapper extends EventEmitter {
  private ref = 1;
  public readonly web3: Web3;
  private newBlockSubscription: null | Subscription<unknown> = null;
  constructor(url: string) {
    super();
    this.setMaxListeners(1000);
    console.log("Creating web3 wrapper");
    const provider = new Web3.providers.WebsocketProvider(url, {
      reconnect: {
        auto: true,
        delay: 1000,
        onTimeout: true,
      },
      clientConfig: {
        maxReceivedFrameSize: 4000000, // bytes - default: 1MiB, current: 4MiB
        maxReceivedMessageSize: 16000000, // bytes - default: 8MiB, current: 16Mib
      },
    });
    provider.on("error", ((e) => {
      console.error("WS provider error", e);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);
    this.web3 = new Web3(provider);
  }
  close() {
    this.ref--;
    if (this.ref <= 0) {
      const provider = this.web3.currentProvider as InstanceType<typeof Web3.providers.WebsocketProvider>;
      console.log("Closing web3 wrapper");
      this.removeAllListeners();
      this.web3.setProvider(null);
      provider.reset();
      provider.disconnect();
    }
  }
  isClosed() {
    return this.ref <= 0;
  }
  addRef() {
    this.ref++;
  }
  private subscribeToNewBlockHeader(lastBlock = -1) {
    if (this.isClosed()) {
      return;
    }
    if (this.newBlockSubscription) {
      this.newBlockSubscription
        .unsubscribe()
        .catch((e) => console.error("Failed to unsubscribe from newBlockHeaders", e));
    }
    let checking = false;
    let latestBlock = lastBlock;
    this.newBlockSubscription = this.web3.eth
      .subscribe("newBlockHeaders")
      .on("data", async (block) => {
        if (this.listenerCount("newBlock") === 0) {
          this.newBlockSubscription?.unsubscribe().catch((e) => {
            console.error("Unable to unsubscribe from newBlockHeaders", e);
          });
          this.newBlockSubscription = null;
          return;
        }
        if (!block.number) {
          return;
        }
        latestBlock = block.number;
        if (lastBlock <= 0) {
          lastBlock = block.number;
          return;
        }
        if (checking) {
          return;
        }
        checking = true;
        try {
          while (lastBlock < latestBlock - 2) {
            lastBlock++;
            const blockWithTransactions: BlockTransactionObject | undefined = await this.web3.eth
              .getBlock(lastBlock, true)
              .catch((e) => {
                console.error("Error getting block:", e);
                this.subscribeToNewBlockHeader(lastBlock - 1);
                return undefined;
              });
            if (!blockWithTransactions) {
              console.log("No block", lastBlock);
              lastBlock--;
              return;
            }
            if (!blockWithTransactions.transactions) {
              console.log("No transactions in block", blockWithTransactions.number, blockWithTransactions);
              return;
            }
            this.emit("newBlock", blockWithTransactions);
          }
        } catch (e) {
          this.emit("error", e);
        } finally {
          checking = false;
        }
      })
      .on("error", (error) => {
        console.error(error);
        this.emit("error", error);
      });
  }
  onNewBlock(callback: (block: BlockTransactionObject) => void) {
    if (this.isClosed()) {
      throw new Error("Web3Wrapper is closed");
    }
    this.addListener("newBlock", callback);
    if (this.listenerCount("newBlock") === 1) {
      this.subscribeToNewBlockHeader();
    }
    return () => {
      this.removeListener("newBlock", callback);
    };
  }
}

const web3Cache = new Map<string, Web3Wrapper>();

function getWeb3(chain = "eth") {
  const url = CHAIN_MAPPING[chain]?.includes("://")
    ? CHAIN_MAPPING[chain]
    : `wss://rpc.ankr.com/${CHAIN_MAPPING[chain] || chain}/ws/${process.env.ANKR_KEY}`;
  let wrapper = web3Cache.get(url);
  if (!wrapper || wrapper.isClosed()) {
    wrapper = new Web3Wrapper(url);
    web3Cache.set(url, wrapper);
  } else {
    wrapper.addRef();
  }
  return {
    web3: wrapper.web3,
    close: () => {
      wrapper?.close();
      wrapper = undefined;
    },
    onNewBlock: wrapper?.onNewBlock.bind(wrapper),
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
    console.log(`[${this.sessionId}] NewTransactionTrigger:`, this.fields.chain, this.fields.from, this.fields.to);
    const { close, onNewBlock } = getWeb3(this.fields.chain);
    const unsubscribe = onNewBlock((blockWithTransactions) => {
      for (const transaction of blockWithTransactions.transactions) {
        if (this.fields.from && !isSameAddress(transaction.from, this.fields.from)) {
          continue;
        }
        if (this.fields.to && !isSameAddress(transaction.to, this.fields.to)) {
          continue;
        }
        console.log(`[${this.sessionId}] NewTransactionTrigger: Sending transaction ${transaction.hash}`);
        this.sendNotification(transaction);
      }
    });
    try {
      await this.waitForStop();
    } catch (e) {
      console.error("Error while monitoring transactions:", e);
    } finally {
      unsubscribe();
      close();
    }
  }
}
export class NewEventTrigger extends TriggerBase<{
  chain: string;
  contractAddress?: string;
  eventDeclaration: string | string[];
  parameterFilters: { [key: string]: unknown };
}> {
  async main() {
    console.log(`[${this.sessionId}] NewEventTrigger: ${this.fields.eventDeclaration}`);
    const eventInfos =
      typeof this.fields.eventDeclaration === "string"
        ? [parseEventDeclaration(this.fields.eventDeclaration)]
        : this.fields.eventDeclaration.map((e) => parseEventDeclaration(e));
    const { web3, close, onNewBlock } = getWeb3(this.fields.chain);
    const eventInfoMap = Object.fromEntries(eventInfos.map((e) => [web3.eth.abi.encodeEventSignature(e), e]));
    const topics = [Object.keys(eventInfoMap)] as (string | string[] | null)[];
    if (topics[0]?.length === 1) {
      topics[0] = topics[0][0];
    }
    const topicInputs = eventInfos[0].inputs || [];
    for (const input of topicInputs) {
      if (input.indexed) {
        const value = this.fields.parameterFilters[input.name];
        topics.push(
          input.name in this.fields.parameterFilters && value !== ""
            ? web3.eth.abi.encodeParameter(input.type, value)
            : null
        );
      }
    }
    while (topics[topics.length - 1] === null) {
      topics.pop();
    }
    const hasContractAddress = this.fields.contractAddress && this.fields.contractAddress !== "0x0";
    if (topics.length <= 1 && !hasContractAddress) {
      throw new InvalidParamsError("No topics to filter on");
    }
    console.log(`[${this.sessionId}] Topics: ${topics}`);
    let pendingLogs = [] as Log[];
    const subscription = web3.eth
      .subscribe("logs", {
        ...(hasContractAddress ? { address: this.fields.contractAddress } : {}),
        topics,
        fromBlock: "latest",
      })
      .on("data", (logEntry) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((logEntry as any).removed) {
          pendingLogs = pendingLogs.filter((x) => {
            const removed = x.blockHash !== logEntry.blockHash;
            if (removed) {
              console.log(`[${this.sessionId}] Removed log ${x.transactionHash} - ${x.logIndex}`);
            }
            return removed;
          });
          return;
        }
        console.log(`[${this.sessionId}] NewEventTrigger: Received log ${logEntry.transactionHash}`);
        pendingLogs.push(logEntry);
      })
      .on("error", (error) => {
        console.error(error);
      });
    const unsubscribeBlock = onNewBlock((block) => {
      if (!block.number) {
        return;
      }
      if (!pendingLogs.length) {
        return;
      }
      const logs = pendingLogs;
      pendingLogs = [];
      const newPendingLogs = [] as Log[];
      for (const logEntry of logs) {
        if (logEntry.blockNumber > block.number - 2) {
          newPendingLogs.push(logEntry);
          continue;
        }
        const eventInfo = eventInfoMap[logEntry.topics[0]];
        if (!eventInfo) {
          console.warn("Unknown event:", logEntry.topics[0], logEntry);
          continue;
        }
        const inputs = eventInfo.inputs || [];
        const decoded = web3.eth.abi.decodeLog(inputs, logEntry.data, logEntry.topics.slice(1));
        const event = {} as { [key: string]: unknown };
        event["_grinderyContractAddress"] = logEntry.address;
        for (const input of inputs) {
          const name = input.name;
          event[name] = decoded[name];
          if (!(name in this.fields.parameterFilters) || this.fields.parameterFilters[name] === "") {
            continue;
          }
          if (
            web3.eth.abi.encodeParameter(input.type, decoded[name]) !==
            web3.eth.abi.encodeParameter(input.type, this.fields.parameterFilters[name])
          ) {
            return;
          }
        }
        const indexedParameters = logEntry.topics.slice(1);
        for (const input of inputs) {
          if (!indexedParameters.length) {
            break;
          }
          if (input.indexed) {
            const value = indexedParameters.shift();
            if (value) {
              event[input.name] = web3.eth.abi.decodeParameter(input.type, value);
            }
          }
        }
        console.log(`[${this.sessionId}] NewEventTrigger: Sending notification ${logEntry.transactionHash}`);
        this.sendNotification({
          _rawEvent: logEntry,
          ...event,
        });
      }
      pendingLogs = pendingLogs.concat(newPendingLogs);
    });
    await this.waitForStop();
    await subscription.unsubscribe();
    await unsubscribeBlock();
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
    gasLimit?: string | number;
    dryRun?: boolean;
  }>
): Promise<ConnectorOutput> {
  const { web3, close } = getWeb3(input.fields.chain);
  try {
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
    const txConfig: TransactionConfig = {
      from: account.address,
      to: input.fields.contractAddress,
      data: callData,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nonce: web3.utils.toHex(await web3.eth.getTransactionCount(account.address)) as any,
    };
    let result: unknown;
    for (const key of ["gasLimit", "maxFeePerGas", "maxPriorityFeePerGas"]) {
      if (key in input.fields && typeof input.fields[key] === "string") {
        input.fields[key] = web3.utils.toWei(input.fields[key], "ether");
      }
    }
    const gas = await web3.eth.estimateGas(txConfig);
    txConfig.gas = Math.ceil(gas * 1.1 + 1000);
    const block = await web3.eth.getBlock("pending");
    const baseFee = Number(block.baseFeePerGas);
    const minFee = baseFee + Number(web3.utils.toWei("30", "gwei"));
    const maxTip = input.fields.maxPriorityFeePerGas || web3.utils.toWei("75", "gwei");
    const maxFee = input.fields.gasLimit
      ? Math.floor(Number(input.fields.gasLimit) / txConfig.gas)
      : baseFee + Number(maxTip);
    if (maxFee < minFee) {
      throw new Error(
        `Gas limit of ${web3.utils.fromWei(
          String(input.fields.gasLimit),
          "ether"
        )} is too low, need at least ${web3.utils.fromWei(String(minFee * txConfig.gas), "ether")}`
      );
    }
    txConfig.maxFeePerGas = maxFee;
    txConfig.maxPriorityFeePerGas = Math.min(Number(maxTip), maxFee - baseFee - 1);
    if (functionInfo.constant || functionInfo.stateMutability === "pure" || input.fields.dryRun) {
      result = {
        returnValue: await web3.eth.call(txConfig),
        estimatedGas: gas,
        minFee,
      };
    } else {
      result = await web3.eth.sendTransaction(txConfig);
    }

    return {
      key: input.key,
      sessionId: input.sessionId,
      payload: result,
    };
  } finally {
    close();
  }
}
