import WebSocket from "ws";
import { connect } from "near-api-js";
import { ConnectorInput, ConnectorOutput, TriggerBase } from "../connectorCommon";
import { InvalidParamsError } from "../jsonrpc";

type Receipt = {
  predecessor_id: string;
  receipt: {
    Action?: {
      actions: (
        | { Transfer: { deposit: string } }
        | {
            FunctionCall: {
              args: string;
              deposit: string;
              gas: number;
              method_name: string;
            };
          }
      )[];
      gas_price: string;
      input_data_ids: unknown[];
      output_data_receivers: unknown[];
      signer_id: string;
      signer_public_key: string;
    };
  };
  receipt_id: string;
  receiver_id: string;
};

class NewTransactionTrigger extends TriggerBase<{ chain: string | string[]; from?: string; to?: string }> {
  async main() {
    if (!this.fields.from && !this.fields.to) {
      // throw new InvalidParamsError("from or to is required");
    }
    console.log(`[${this.sessionId}] NewTransactionTrigger:`, this.fields.chain, this.fields.from, this.fields.to);
    const config = {
      networkId: "mainnet",
      nodeUrl: "https://rpc.mainnet.near.org",
      walletUrl: "https://wallet.mainnet.near.org",
      helperUrl: "https://helper.mainnet.near.org",
      explorerUrl: "https://explorer.mainnet.near.org",
      headers: {},
    };
    const near = await connect(config);
    let currentBlock = -1;
    while (this.isRunning()) {
      try {
        const response = await near.connection.provider.block(
          currentBlock < 0
            ? {
                finality: "final",
              }
            : { blockId: currentBlock + 1 }
        );
        // console.log(response);
        currentBlock = response.header.height;
        for (const chunk of response.chunks) {
          const chunkDetails = await near.connection.provider.chunk(chunk.chunk_hash);
          for (const receipt of chunkDetails.receipts as Receipt[]) {
            if (this.fields.from && this.fields.from !== receipt.receipt.Action?.signer_id) {
              continue;
            }
            if (this.fields.to && this.fields.to !== receipt.receiver_id) {
              continue;
            }
            for (const action of receipt.receipt.Action?.actions ?? []) {
              if (!("Transfer" in action)) {
                continue;
              }
              const transfer = action.Transfer;
              this.sendNotification({
                from: receipt.receipt.Action?.signer_id,
                to: receipt.receiver_id,
                value: transfer.deposit,
                ...receipt,
              });
            }
          }
        }
      } catch (e) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
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
    throw new Error("Method not implemented.");
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
