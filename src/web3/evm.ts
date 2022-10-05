import { ConnectorInput, ConnectorOutput, TriggerBase } from "grindery-nexus-common-utils/dist/connector";
import { TransactionConfig } from "web3-core";
import abi from "web3-eth-abi";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import {
  getWeb3,
  isSameAddress,
  onNewBlockMultiChain,
  parseEventDeclaration,
  parseFunctionDeclaration,
} from "./web3Utils";
import { encodeExecTransaction, execTransactionAbi } from "./gnosisSafe";

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
      async ({ block, chain, web3, callOnce }) => {
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
        callOnce("getPastLogsMap", () =>
          web3.eth
            .getPastLogs({
              fromBlock: block.number,
              toBlock: block.number,
            })
            .then((logs) => {
              const map = new Map<string, typeof logs>();
              for (const logEntry of logs) {
                const eventSignature = logEntry.topics[0];
                if (!map.has(eventSignature)) {
                  map.set(eventSignature, []);
                }
                map.get(eventSignature)?.push(logEntry);
              }
              return map;
            })
        )
          .then((logsMap) => {
            for (const logEntry of Array.prototype.concat.apply(
              [],
              Object.keys(eventInfoMap).map((x) => logsMap.get(x) || [])
            )) {
              if (contractAddress && !isSameAddress(logEntry.address, contractAddress)) {
                continue;
              }
              const eventInfo = eventInfoMap[logEntry.topics[0]];
              if (!eventInfo) {
                continue;
              }
              const inputs = eventInfo.inputs || [];
              const numIndexedInputs = inputs.filter((x) => x.indexed).length;
              if (numIndexedInputs !== logEntry.topics.length - 1) {
                // Some contracts don't use standard number of indexed parameters, ignore this entry because we don't know how to decode it
                /*
                console.debug(`[${this.sessionId}] Number of indexed inputs doesn't match event declaration`, {
                  sessionId: this.sessionId,
                  inputs,
                  logEntry,
                  contractAddress,
                  eventDeclaration: this.fields.eventDeclaration,
                  parameterFilters: this.fields.parameterFilters,
                  chain,
                });
                */
                continue;
              }
              let decoded: { [key: string]: string };
              try {
                decoded = web3.eth.abi.decodeLog(inputs, logEntry.data, logEntry.topics.slice(1));
              } catch (e) {
                console.error(
                  `[${this.sessionId}] Failed to decode log`,
                  {
                    sessionId: this.sessionId,
                    inputs,
                    logEntry,
                    contractAddress,
                    eventDeclaration: this.fields.eventDeclaration,
                    parameterFilters: this.fields.parameterFilters,
                    chain,
                  },
                  e
                );
                continue;
              }
              const event = {} as { [key: string]: unknown };
              event["_grinderyContractAddress"] = logEntry.address;
              event["_grinderyChain"] = chain;
              let match = true;
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
                  match = false;
                  break;
                }
              }
              if (!match) {
                continue;
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
              let chainId = chain;
              const m = /^eip155:(\d+)$/.exec(chainId);
              if (m) {
                chainId = m[1];
              }
              this.sendNotification({
                _rawEvent: logEntry,
                __transactionHash: logEntry.transactionHash,
                __chainId: chainId,
                ...event,
              });
            }
          })
          .catch((e) => {
            console.error(`[${this.sessionId}] Error while getting logs for block ${block.number}:`, e);
          });
      },
      (e) => this.interrupt(e)
    );
    await this.waitForStop();
    unsubscribe();
  }
}

export const Triggers = new Map<string, new (params: ConnectorInput) => TriggerBase>();
Triggers.set("newTransaction", NewTransactionTrigger);
Triggers.set("newEvent", NewEventTrigger);

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
    if (!web3.defaultAccount) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const account = web3.eth.accounts.privateKeyToAccount(process.env.WEB3_PRIVATE_KEY!);
      web3.eth.accounts.wallet.add(account);
      web3.eth.defaultAccount = account.address;
      web3.defaultAccount = account.address;
    }

    let callData: string;
    let functionInfo: ReturnType<typeof parseFunctionDeclaration>;
    if (input.fields.functionDeclaration === "!gnosisSafeSimpleTransfer") {
      functionInfo = execTransactionAbi;
      const result = await encodeExecTransaction({
        web3,
        contractAddress: input.fields.contractAddress,
        parameters: input.fields.parameters,
        dryRun: input.fields.dryRun ?? false,
      });
      if (typeof result === "string") {
        callData = result;
      } else {
        return {
          key: input.key,
          sessionId: input.sessionId,
          payload: result,
        };
      }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const paramArray = [] as any[];
      functionInfo = parseFunctionDeclaration(input.fields.functionDeclaration);
      const inputs = functionInfo.inputs || [];
      for (const i of inputs) {
        if (!(i.name in input.fields.parameters)) {
          throw new Error("Missing parameter " + i.name);
        }
        paramArray.push(input.fields.parameters[i.name]);
      }
      callData = web3.eth.abi.encodeFunctionCall(functionInfo, paramArray);
    }
    const txConfig: TransactionConfig = {
      from: web3.defaultAccount,
      to: input.fields.contractAddress,
      data: callData,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nonce: web3.utils.toHex(await web3.eth.getTransactionCount(web3.defaultAccount)) as any,
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
      let returnValue;
      try {
        returnValue = await web3.eth.call(txConfig);
        result = {
          returnValue,
          estimatedGas: gas,
          minFee,
        };
      } catch (e) {
        if (!input.fields.dryRun) {
          throw e;
        }
        result = {
          _grinderyDryRunError:
            "Can't confirm that the transaction can be executed due to the following error: " + e.toString(),
        };
      }
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
