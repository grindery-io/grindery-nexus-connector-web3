import { TriggerBase } from "grindery-nexus-common-utils/dist/connector";
import abi from "web3-eth-abi";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import { isSameAddress, onNewBlockMultiChain, parseEventDeclaration } from "./utils";

export class NewTransactionTrigger extends TriggerBase<{ chain: string | string[]; from?: string; to?: string }> {
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
export class NewEventTrigger extends TriggerBase<{
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
            const entries = Object.keys(eventInfoMap)
              .map((x) => logsMap.get(x) || [])
              .flat();
            for (const logEntry of entries) {
              if (contractAddress && !isSameAddress(logEntry.address, contractAddress)) {
                continue;
              }
              if (!logEntry.topics?.[0]) {
                console.warn(`Got invalid log entry (${logEntry.transactionHash || "no hash"})`, {
                  logEntry: { ...logEntry },
                });
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
                  `[${this.sessionId}] Failed to decode log [${logEntry.transactionHash} - ${logEntry.transactionIndex} - ${logEntry.logIndex}]`,
                  {
                    sessionId: this.sessionId,
                    inputs,
                    contractAddress,
                    eventDeclaration: this.fields.eventDeclaration,
                    parameterFilters: this.fields.parameterFilters,
                    chain,
                    topics: logEntry.topics,
                    data: logEntry.data,
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
