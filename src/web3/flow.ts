import WebSocket, { EventEmitter } from "ws";
import axios from "axios";
import { ConnectorInput, ConnectorOutput, TriggerBase } from "../connectorCommon";
import { InvalidParamsError } from "../jsonrpc";

type Block = {
  header: {
    id: string;
    parent_id: string;
    height: string;
    timestamp: string;
    parent_voter_signature: string;
  };
};
type EventHeader = {
  type: string;
  transaction_id: string;
  transaction_index: string;
  event_index: string;
};
type BlockEvent = {
  block_id: string;
  block_height: string;
  block_timestamp: string;
  events: ({
    payload: string;
  } & EventHeader)[];
};
type ParsedEventBody = {
  type: "Event";
  value: {
    id: string;
    fields: {
      name: string;
      value:
        | { type: string; value?: string | number | boolean }
        | { type: "Optional"; value?: { type: string; value: unknown } };
    }[];
  };
};
type ParsedEvent = EventHeader & {
  block_id: string;
  block_height: string;
  body: ParsedEventBody;
};

async function flowApi(path: "blocks", params: { [key: string]: string }): Promise<Block[]>;
async function flowApi(path: "events", params: { [key: string]: string }): Promise<BlockEvent[]>;
async function flowApi(path: string, params: { [key: string]: string }): Promise<unknown> {
  const response = await axios.get("https://rest-mainnet.onflow.org/v1/" + path, {
    params,
  });
  return response.data;
}

class EventAggregator {
  private transactions = new Map<string, { [key: string]: ParsedEvent[] }>();
  private addedEvents = new Set<string>();
  private endHeight = "sealed" as "sealed" | number;
  private fetchPromises = new Map<string, Promise<void>>();
  constructor(private startHeight: number, private contractAddress: string) {}

  async fetchEvent(type: string) {
    if (this.fetchPromises.has(type)) {
      return this.fetchPromises.get(type);
    }
    if (this.addedEvents.has(type)) {
      return;
    }
    const promise = this.fetchEventImpl(type);
    this.fetchPromises.set(type, promise);
    try {
      await promise;
      this.addedEvents.add(type);
    } finally {
      this.fetchPromises.delete(type);
    }
  }
  async fetchEventImpl(type: string) {
    if (this.addedEvents.has(type)) {
      return;
    }
    const fullType = `${this.contractAddress}.${type}`;
    const resp = await flowApi("events", {
      start_height: this.startHeight.toString(),
      end_height: this.endHeight.toString(),
      type: fullType,
    });
    for (const block of resp) {
      const height = parseInt(block.block_height, 10);
      if (this.endHeight === "sealed" || height > this.endHeight) {
        this.endHeight = height;
      }
      for (const event of block.events) {
        let body: ParsedEventBody;
        try {
          body = JSON.parse(Buffer.from(event.payload, "base64").toString("utf8"));
        } catch (e) {
          console.error("Failed to decode event payload:", event, e);
          continue;
        }
        if (body.type !== "Event") {
          console.error("Unexpected payload type:", body);
          continue;
        }
        if (body.value?.id !== fullType) {
          console.error(`Unexpected event id, expected: ${fullType}, event:`, body);
          continue;
        }
        let eventMap = this.transactions.get(event.transaction_id);
        if (!eventMap) {
          eventMap = {};
          this.transactions.set(event.transaction_id, eventMap);
        }
        if (!eventMap[type]) {
          eventMap[type] = [];
        }
        eventMap[type].push({
          ...event,
          body,
          block_id: block.block_id,
          block_height: block.block_height,
        });
      }
    }
  }
  async forEach(type: string, callback: (events: { [key: string]: ParsedEvent[] }) => Promise<unknown>) {
    await this.fetchEvent(type);
    for (const transaction of this.transactions.values()) {
      if (transaction[type]) {
        callback(transaction);
      }
    }
  }
  getEndHeight(): number {
    if (this.endHeight === "sealed") {
      throw new Error("End height is not known");
    }
    return this.endHeight;
  }
}
class ContractSubscriber extends EventEmitter {
  private running = false;
  constructor(private contractAddress: string) {
    super();
    this.setMaxListeners(1000);
  }
  async main() {
    if (this.running) {
      return;
    }
    this.running = true;
    const block = await flowApi("blocks", { height: "sealed" });
    let nextBlock = parseInt(block[0].header.height, 10) - 1;
    while (this.listenerCount("process") > 0) {
      const aggregator = new EventAggregator(nextBlock, this.contractAddress);
      try {
        for (const listener of this.listeners("process")) {
          await listener(aggregator);
        }
      } catch (e) {
        if (e.isAxiosError && (e.response?.status === 400 || e.response?.status >= 500)) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
        console.error("Error in Flow event loop:", e);
        this.emit("error", e);
        this.running = false;
        return;
      }
      nextBlock = aggregator.getEndHeight() + 1;
    }
    this.running = false;
  }
  subscribe({
    eventDeclaration,
    parameterFilters,
    callback,
    onError,
  }: {
    eventDeclaration: string;
    parameterFilters: { [key: string]: unknown };
    callback: (output: { _metadata: { [key: string]: unknown }; [key: string]: unknown }) => void;
    onError: (error: unknown) => void;
  }) {
    const eventDecls = eventDeclaration.split("/");
    const primaryEvent = eventDecls[0];
    if (!/^[a-z0-9_]+$/i.test(primaryEvent || "")) {
      throw new InvalidParamsError("Invalid event declaration: Invalid primary event name: " + primaryEvent);
    }
    const secondaryEvents = eventDecls.slice(1).map((s) => {
      const m = /^([a-z0-9_]+)(?:\[([a-z0-9_]+)\])?$/i.exec(s);
      if (!m) {
        throw new InvalidParamsError("Invalid event declaration: Invalid secondary event: " + s);
      }
      return {
        name: m[1],
        matchingField: m[2],
      };
    });
    const handler = async (aggregator: EventAggregator) => {
      await aggregator.forEach(primaryEvent, async (events) => {
        for (const event of events[primaryEvent] || []) {
          const eventFields = event.body.value.fields;
          const output = eventFields.reduce((acc, field) => {
            if (field.value.value === undefined) {
              return acc;
            }
            acc[field.name] = typeof field.value.value === "object" ? field.value.value.value : field.value.value;
            return acc;
          }, {});
          let fastSkip = false;
          for (const [key, value] of Object.entries(parameterFilters)) {
            if (key.startsWith("_grindery")) {
              continue;
            }
            if (key in output && output[key] !== value) {
              fastSkip = true;
              break;
            }
          }
          if (secondaryEvents.some((x) => x.matchingField && !(x.matchingField in output))) {
            fastSkip = true;
          }
          if (fastSkip) {
            continue;
          }
          for (const secondaryEvent of secondaryEvents) {
            await aggregator.fetchEvent(secondaryEvent.name);
            const matchedEvent = events[secondaryEvent.name]?.find((e) => {
              if (!secondaryEvent.matchingField) {
                return true;
              }
              if (!(secondaryEvent.matchingField in output)) {
                return false;
              }
              const valueObj = e.body.value.fields.find((f) => f.name === secondaryEvent.matchingField)?.value.value;
              const value = typeof valueObj === "object" ? valueObj.value : valueObj;
              return value === output[secondaryEvent.matchingField];
            });
            if (matchedEvent) {
              for (const field of matchedEvent.body.value.fields) {
                const valueObj = field.value.value;
                const value = typeof valueObj === "object" ? valueObj.value : valueObj;
                output[`${secondaryEvent.name}_${field.name}`] = value;
                if (!(field.name in output)) {
                  output[field.name] = value;
                }
              }
            }
          }
          for (const [key, value] of Object.entries(parameterFilters)) {
            if (key.startsWith("_grindery")) {
              continue;
            }
            if (output[key] !== value) {
              return;
            }
          }
          callback({
            _metadata: {
              transactionId: event.transaction_id,
              blockHeight: event.block_height,
              blockId: event.block_id,
              primaryEvent,
            },
            ...output,
          });
        }
      });
    };
    const errorHandler = (error: unknown) => {
      onError(error);
    };
    this.on("process", handler);
    if (!this.running) {
      this.main().catch((e) => console.error("Error in Flow event main loop:", e));
    }
    return () => {
      this.off("process", handler);
      this.off("error", errorHandler);
    };
  }
}

const subscribers = new Map<string, ContractSubscriber>();
function getSubscriber(contractAddress: string): ContractSubscriber {
  if (!subscribers.has(contractAddress)) {
    subscribers.set(contractAddress, new ContractSubscriber(contractAddress));
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return subscribers.get(contractAddress)!;
}

class NewTransactionTrigger extends TriggerBase<{ chain: string; from?: string; to?: string }> {
  async main() {
    if (!this.fields.from && !this.fields.to) {
      throw new InvalidParamsError("from or to is required");
    }
    const contract = "A.1654653399040a61.FlowToken";
    const subscriber = getSubscriber(contract);
    console.log(`[${this.sessionId}] NewTransactionTrigger:`, this.fields.from, this.fields.to);
    const unsubscribe = subscriber.subscribe({
      eventDeclaration: "TokensDeposited/TokensWithdrawn[amount]",
      parameterFilters: {
        ...(this.fields.from ? { from: this.fields.from } : {}),
        ...(this.fields.to ? { to: this.fields.to } : {}),
      },
      callback: (output) => {
        this.sendNotification({
          _grinderyChain: this.fields.chain,
          _grinderyContractAddress: contract,
          from: output.from,
          to: output.to,
          value: output.amount,
          hash: output._metadata.transactionId,
          blockNumber: output._metadata.blockHeight,
          blockHash: output._metadata.blockId,
        });
      },
      onError: (e) => {
        this.interrupt(e);
      },
    });
    try {
      await this.waitForStop();
    } finally {
      unsubscribe();
    }
  }
}
class NewEventTrigger extends TriggerBase<{
  chain: string;
  contractAddress: string;
  eventDeclaration: string | string[];
  parameterFilters: { [key: string]: unknown };
}> {
  async main() {
    if (!this.fields.contractAddress) {
      throw new InvalidParamsError("Missing contract address");
    }
    if (!/^A\.[0-9a-f]{16}\.[0-9a-z]+$/i.test(this.fields.contractAddress)) {
      throw new InvalidParamsError("Invalid contract address: " + this.fields.contractAddress);
    }
    if (typeof this.fields.eventDeclaration !== "string") {
      throw new InvalidParamsError("Multiple event declarations not supported");
    }
    console.log(
      `[${this.sessionId}] NewEventTrigger:`,
      this.fields.contractAddress,
      this.fields.eventDeclaration,
      this.fields.parameterFilters
    );
    const subscriber = getSubscriber(this.fields.contractAddress);
    const unsubscribe = subscriber.subscribe({
      eventDeclaration: this.fields.eventDeclaration,
      parameterFilters: this.fields.parameterFilters,
      callback: (output) => {
        output["_grinderyChain"] = this.fields.chain;
        output["_grinderyContractAddress"] = this.fields.contractAddress;
        this.sendNotification(output);
      },
      onError: (e) => {
        this.interrupt(e);
      },
    });
    try {
      await this.waitForStop();
    } finally {
      unsubscribe();
    }
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
  console.log("callSmartContract", input);
  throw new Error("Not implemented");
}
