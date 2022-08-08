import WebSocket from "ws";
import { ConnectorInput, ConnectorOutput, TriggerBase } from "../connectorCommon";
import { TransactionConfig } from "web3-core";
import abi from "web3-eth-abi";
import { InvalidParamsError } from "../jsonrpc";
import {
  getWeb3,
  isSameAddress,
  onNewBlockMultiChain,
  parseEventDeclaration,
  parseFunctionDeclaration,
} from "./web3Utils";

class NewTransactionTrigger extends TriggerBase<{ chain: string | string[]; from?: string; to?: string }> {
  async main() {
    if (!this.fields.chain || !this.fields.chain.length) {
      throw new InvalidParamsError("chain is required");
    }
    if (!this.fields.from && !this.fields.to) {
      throw new InvalidParamsError("from or to is required");
    }
    console.log(`[${this.sessionId}] NewTransactionTrigger:`, this.fields.chain, this.fields.from, this.fields.to);
    const unsubscribe = onNewBlockMultiChain(
      this.fields.chain,
      async ({ block, chain }) => {
        for (const transaction of block.transactions) {
          if (this.fields.from && !isSameAddress(transaction.from, this.fields.from)) {
            continue;
          }
          if (this.fields.to && !isSameAddress(transaction.to, this.fields.to)) {
            continue;
          }
          console.log(`[${this.sessionId}] NewTransactionTrigger: Sending transaction ${transaction.hash}`);
          this.sendNotification({ ...transaction, _grinderyChain: chain });
        }
      },
      (e) => this.interrupt(e)
    );
    try {
      await this.waitForStop();
    } catch (e) {
      console.error("Error while monitoring transactions:", e);
    } finally {
      unsubscribe();
    }
  }
}
class NewEventTrigger extends TriggerBase<{
  chain: string | string[];
  contractAddress?: string;
  eventDeclaration: string | string[];
  parameterFilters: { [key: string]: unknown };
}> {
  async main() {
    if (!this.fields.chain || !this.fields.chain.length) {
      throw new InvalidParamsError("chain is required");
    }
    console.log(`[${this.sessionId}] NewEventTrigger: ${this.fields.chain} ${this.fields.eventDeclaration}`);
    const eventInfos =
      typeof this.fields.eventDeclaration === "string"
        ? [parseEventDeclaration(this.fields.eventDeclaration)]
        : this.fields.eventDeclaration.map((e) => parseEventDeclaration(e));
    const eventInfoMap = Object.fromEntries(eventInfos.map((e) => [abi.encodeEventSignature(e), e]));
    const topics = [Object.keys(eventInfoMap)] as (string | string[] | null)[];
    if (topics[0]?.length === 1) {
      topics[0] = topics[0][0];
    }
    const topicInputs = eventInfos[0].inputs || [];
    for (const input of topicInputs) {
      if (input.indexed) {
        const value = this.fields.parameterFilters[input.name];
        topics.push(
          input.name in this.fields.parameterFilters && value !== "" ? abi.encodeParameter(input.type, value) : null
        );
      }
    }
    while (!topics[topics.length - 1]) {
      topics.pop();
    }
    const contractAddress =
      this.fields.contractAddress && this.fields.contractAddress !== "0x0" ? this.fields.contractAddress : undefined;
    if (topics.length <= 1 && !contractAddress) {
      throw new InvalidParamsError("No topics to filter on");
    }
    console.log(`[${this.sessionId}] Topics: ${topics}`);
    const unsubscribe = onNewBlockMultiChain(
      this.fields.chain,
      async ({ block, chain, web3 }) => {
        if (contractAddress && !web3.utils.isContractAddressInBloom(block.logsBloom, contractAddress)) {
          return;
        }
        for (const topic of topics) {
          if (!topic) {
            continue;
          }
          if (typeof topic === "string") {
            if (!web3.utils.isTopicInBloom(block.logsBloom, topic)) {
              return;
            }
            continue;
          }
          let found = false;
          for (const singleTopic of topic) {
            if (web3.utils.isTopicInBloom(block.logsBloom, singleTopic)) {
              found = true;
              break;
            }
          }
          if (!found) {
            return;
          }
        }
        web3.eth
          .getPastLogs({
            fromBlock: block.number,
            toBlock: block.number,
            ...(contractAddress ? { address: contractAddress } : {}),
            topics,
          })
          .then((logs) => {
            for (const logEntry of logs) {
              const eventInfo = eventInfoMap[logEntry.topics[0]];
              if (!eventInfo) {
                console.warn("Unknown event:", logEntry.topics[0], logEntry);
                continue;
              }
              const inputs = eventInfo.inputs || [];
              const decoded = web3.eth.abi.decodeLog(inputs, logEntry.data, logEntry.topics.slice(1));
              const event = {} as { [key: string]: unknown };
              event["_grinderyContractAddress"] = logEntry.address;
              event["_grinderyChain"] = chain;
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
          })
          .catch((e) => {
            console.error(`Error while getting logs for block ${block.number}:`, e);
          });
      },
      (e) => this.interrupt(e)
    );
    await this.waitForStop();
    unsubscribe();
  }
}

export const Triggers = new Map<string, (socket: WebSocket, params: ConnectorInput) => TriggerBase>();
Triggers.set("newTransaction", (socket, params) => new NewTransactionTrigger(socket, params));
Triggers.set("newEvent", (socket, params) => new NewEventTrigger(socket, params));

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
