import { TriggerBase } from "grindery-nexus-common-utils/dist/connector";
import abi from "web3-eth-abi";
import { InvalidParamsError } from "grindery-nexus-common-utils/dist/jsonrpc";
import { isSameAddress, onNewBlockMultiChain, parseEventDeclaration } from "./utils";
import blockingTracer from "../../blockingTracer";
import { getWeb3 } from "./web3";
import { BigNumber } from "@ethersproject/bignumber";
import { backOff } from "exponential-backoff";

export class NewTransactionTrigger extends TriggerBase<{ chain: string | string[]; from?: string; to?: string }> {
  async main() {
    if (!this.fields.chain || !this.fields.chain.length) {
      throw new InvalidParamsError("chain is required");
    }
    if (!this.fields.from && !this.fields.to) {
      throw new InvalidParamsError("from or to is required");
    }
    const { close, ethersProvider } = getWeb3(this.fields.chain as string);
    console.log(`[${this.sessionId}] NewTransactionTrigger:`, this.fields.chain, this.fields.from, this.fields.to);
    const unsubscribe = onNewBlockMultiChain(
      this.fields.chain,
      async ({ block, chain, memoCall }) => {
        blockingTracer.tag("evm.NewTransactionTrigger");
        for (const transaction of block.transactions) {
          if (this.fields.from && !isSameAddress(transaction.from, this.fields.from)) {
            continue;
          }
          if (this.fields.to && !isSameAddress(transaction.to, this.fields.to)) {
            continue;
          }
          const timestamp = Date.now();
          const diff = BigNumber.from(timestamp).sub(BigNumber.from(block.timestamp).mul(1000));
          if (diff.gt(1000 * 60 * 10)) {
            memoCall("delayedBlockWarning", () =>
              console.warn(`[${chain}] Block ${block.number} is delayed by ${diff.div(1000 * 60).toString()} minutes`)
            );
          }

          let txfees = BigNumber.from(transaction.gas).mul(
            BigNumber.from(transaction.gasPrice || transaction.maxFeePerGas?.toString() || block.baseFeePerGas || "0")
          );
          try {
            const transactionReceipt = await memoCall("getTransactionFee", () =>
              ethersProvider.getTransactionReceipt(transaction.hash)
            );
            txfees = BigNumber.from(transactionReceipt.gasUsed || transaction.gas).mul(
              BigNumber.from(
                transactionReceipt.effectiveGasPrice ||
                  transaction.gasPrice ||
                  transaction.maxFeePerGas?.toString() ||
                  block.baseFeePerGas ||
                  "0"
              )
            );
          } catch (e) {
            console.warn(
              `[${this.sessionId}] NewTransactionTrigger: Failed to get transaction fee for [${chain}] ${
                transaction.hash
              }, using estimated fee ${txfees.toString()}`,
              e
            );
          }
          const elapsed = Date.now() - timestamp;
          if (elapsed > 60000) {
            console.warn(
              `[${this.sessionId}] getTransactionFee for transaction ${transaction.hash} took ${elapsed}ms to complete`
            );
          }
          console.log(`[${this.sessionId}] NewTransactionTrigger: Sending transaction [${chain}] ${transaction.hash}`, {
            timestamp: BigNumber.from(block.timestamp).toString(),
          });
          this.sendNotification({
            ...transaction,
            _grinderyChain: chain,
            txfees: txfees.toString(),
          });
        }
      },
      (e) => this.interrupt(e)
    );
    try {
      await this.waitForStop();
    } catch (e) {
      console.error("Error while monitoring transactions:", e);
      throw e;
    } finally {
      unsubscribe();
      close();
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
      async ({ block, chain, web3, memoCall }) => {
        blockingTracer.tag("evm.NewEventTrigger");
        if (
          contractAddress &&
          !memoCall("bloom-" + contractAddress, () =>
            web3.utils.isContractAddressInBloom(block.logsBloom, contractAddress)
          )
        ) {
          return;
        }
        for (const topic of topics) {
          if (!topic) {
            continue;
          }
          if (typeof topic === "string") {
            if (!memoCall("bloom-" + topic, () => web3.utils.isTopicInBloom(block.logsBloom, topic))) {
              return;
            }
            continue;
          }
          let found = false;
          for (const singleTopic of topic) {
            if (memoCall("bloom-" + singleTopic, () => web3.utils.isTopicInBloom(block.logsBloom, singleTopic))) {
              found = true;
              break;
            }
          }
          if (!found) {
            return;
          }
        }
        const timestamp = Date.now();
        memoCall("getPastLogsMap", () =>
          backOff(
            () =>
              web3.eth.getPastLogs({
                fromBlock: block.number,
                toBlock: block.number,
              }),
            {
              jitter: "full",
              startingDelay: 1000,
              maxDelay: 15000,
              numOfAttempts: 10,
              retry: (e, attemptNumber) => {
                console.error(`[${chain}] Failed to get logs for block ${block.number} (attempt ${attemptNumber}):`, e);
                return true;
              },
            }
          ).then((logs) => {
            const elapsed = Date.now() - timestamp;
            if (elapsed > 60000) {
              console.warn(`[${chain}] getPastLogs for block ${block.number} took ${elapsed}ms to complete`);
            }
            blockingTracer.tag("evm.NewEventTrigger.processLogsOnce");
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
          .then(async (logsMap) => {
            blockingTracer.tag("evm.NewEventTrigger.processLogs");
            const entries = Object.keys(eventInfoMap)
              .map((x) => logsMap.get(x) || [])
              .flat();
            const transactionLogFailures: { [key: string]: number } = {};
            let numProcessed = 0;
            for (const logEntry of entries as ((typeof entries)[0] & {
              __decodeFailure?: boolean;
              __decoded?: { [key: string]: string };
            })[]) {
              if (logEntry.__decodeFailure) {
                continue;
              }
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
              numProcessed++;
              if (numProcessed > 50) {
                numProcessed = 0;
                // Try not to block event loop for too long
                await new Promise((res) => setImmediate(res));
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
                decoded = logEntry.__decoded || web3.eth.abi.decodeLog(inputs, logEntry.data, logEntry.topics.slice(1));
                logEntry.__decoded = decoded;
              } catch (e) {
                logEntry.__decodeFailure = true;
                if (!transactionLogFailures[logEntry.transactionHash]) {
                  transactionLogFailures[logEntry.transactionHash] = 0;
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
                }
                transactionLogFailures[logEntry.transactionHash]++;
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
              console.log(
                `[${this.sessionId}] NewEventTrigger: Sending notification [${chain}] ${logEntry.transactionHash} #${logEntry.logIndex}`,
                {
                  timestamp: BigNumber.from(block.timestamp).toString(),
                }
              );
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
            for (const [transaction, num] of Object.entries(transactionLogFailures)) {
              if (num > 1) {
                console.warn(
                  `[${this.sessionId}] Transaction ${transaction} has ${num} log entries that can't be decoded`
                );
              }
            }
          })
          .catch((e) => {
            memoCall("getLogError" + e.toString(), () =>
              console.error(`[${this.sessionId}] Error while getting logs for block ${block.number}:`, e)
            );
          });
      },
      (e) => this.interrupt(e)
    );
    await this.waitForStop();
    unsubscribe();
  }
}
