import { ethers } from "ethers";
import { EventEmitter } from "node:events";
import _ from "lodash";
import axios from "axios";
import { diff } from "deep-object-diff";
import { API_BASE, processSafeTxInfo } from "../common";
import { TriggerBase } from "grindery-nexus-common-utils";

type SafeApiTx = {
  id: string;
  timestamp: number;
  txStatus: "AWAITING_CONFIRMATIONS" | string;
  txInfo: {
    type: string;
    isCancellation?: boolean;
    [key: string]: unknown;
  };
  executionInfo: {
    type: "MULTISIG" | string;
    nonce: number;
    confirmationsRequired: number;
    confirmationsSubmitted: number;
    missingSigners: { value: string }[];
  };
};
type SafeEvent = {
  type: "new_proposal" | "new_confirmation" | "new_rejection";
  payload: Record<string, unknown>;
};

class SafeProposalListener extends EventEmitter {
  private static allInstances = new Map<string, SafeProposalListener>();

  private running = false;

  private constructor(private address: string, private chainId: number) {
    super();
    this.address = ethers.utils.getAddress(address);
  }
  static getInstance(address: string, chainId: number) {
    const cacheKey = `${chainId}/${address}`;
    if (!this.allInstances.has(cacheKey)) {
      this.allInstances.set(cacheKey, new SafeProposalListener(address, chainId));
    }
    return this.allInstances.get(cacheKey) as SafeProposalListener;
  }
  private maybeStart() {
    if (this.running) {
      return;
    }
    if (this.listenerCount("safe_event") === 0) {
      return;
    }
    this.running = true;
    this.main()
      .catch((e) => console.error(`[${this.chainId}/${this.address}] Unexpected error:`, e))
      .finally(() => (this.running = false))
      .then(() => new Promise((res) => setTimeout(res, 5000)))
      .then(this.maybeStart.bind(this));
  }
  private async main() {
    const snapshot = new Map<string, Record<string, SafeApiTx>>();
    let starting = true;
    while (this.listenerCount("safe_event") > 0) {
      const resp = await axios
        .get(`${API_BASE}v1/chains/${this.chainId}/safes/${this.address}/transactions/queued?limit=1000`)
        .catch((e) => {
          console.error(`[${this.chainId}/${this.address}] Failed to get queued transactions:`, e.response?.data || e);
        });
      if (!resp) {
        continue;
      }
      const groupsMap = _.groupBy(
        resp.data.results.filter((x) => x.type === "TRANSACTION").map((x) => x.transaction) as SafeApiTx[],
        "executionInfo.nonce"
      );
      const groups = Object.entries(groupsMap);
      for (const [nonce, transactions] of groups) {
        if (!nonce) {
          continue;
        }
        const txMap = Object.fromEntries(transactions.map((x) => [x.id, x]));
        if (starting) {
          snapshot.set(nonce, txMap);
          continue;
        }
        const oldTxMap = snapshot.get(nonce) || {};
        const txDiff = diff(oldTxMap, txMap) as Record<string, SafeApiTx>;
        const mainTx = transactions.sort((a, b) => b.timestamp - a.timestamp).find((x) => !x.txInfo?.isCancellation);
        const cancelTx = transactions.find((x) => x.txInfo?.isCancellation);
        if (!mainTx) {
          console.warn(`[${this.chainId}/${this.address}] Can't find main tx for nonce ${nonce}`, { transactions });
          continue;
        }
        const payload: Record<string, unknown> = { id: mainTx.id };
        const type = processSafeTxInfo(_.cloneDeep(mainTx), payload);
        Object.assign(payload, mainTx.executionInfo || {});
        payload.type = type;
        if (!snapshot.has(nonce)) {
          this.emit("safe_event", { type: "new_proposal", payload: { ...payload } });
        } else if (txDiff[mainTx.id]?.executionInfo?.confirmationsSubmitted) {
          this.emit("safe_event", { type: "new_confirmation", payload: { ...payload } });
        }

        if (cancelTx) {
          Object.assign(payload, cancelTx.executionInfo || {});
          payload.safeRejectionTxInfo = cancelTx;
          payload.rejectedType = type;
          payload.type = "rejection";
          if (!oldTxMap[cancelTx.id]) {
            this.emit("safe_event", { type: "new_rejection", payload: { ...payload } });
          } else if (txDiff[cancelTx.id]?.executionInfo?.confirmationsSubmitted) {
            this.emit("safe_event", { type: "new_confirmation", payload: { ...payload } });
          }
        }
        snapshot.set(nonce, txMap);
      }
      for (const nonce of snapshot.keys()) {
        if (!groupsMap[nonce]) {
          snapshot.delete(nonce);
        }
      }
      starting = false;
      await new Promise((res) => setTimeout(res, 30000));
    }
  }
  on(e: "safe_event", listener: (obj: SafeEvent) => void) {
    setImmediate(this.maybeStart.bind(this));
    return super.on(e, listener);
  }
  off(e: "safe_event", listener: (obj: SafeEvent) => void) {
    return super.off(e, listener);
  }
  emit(e: "safe_event", obj: SafeEvent) {
    return super.emit(e, obj);
  }
}

abstract class QueuedTransactionTriggerBase extends TriggerBase<{
  _grinderyChain: string;
  _grinderyContractAddress: string;
}> {
  abstract filterEvent(e: SafeEvent): boolean;
  async main() {
    const m = /eip155:(\d+)/.exec(this.fields._grinderyChain);
    if (!m) {
      throw new Error("Invalid chain: " + this.fields._grinderyChain);
    }
    const listener = SafeProposalListener.getInstance(this.fields._grinderyContractAddress, parseInt(m[1], 10));
    const handler = (e: SafeEvent) => {
      if (this.filterEvent(e)) {
        this.sendNotification(e.payload);
      }
    };
    listener.on("safe_event", handler);
    try {
      await this.waitForStop();
    } finally {
      listener.off("safe_event", handler);
    }
  }
}

export class TransactionProposedTrigger extends QueuedTransactionTriggerBase {
  filterEvent(e: SafeEvent): boolean {
    return e.type === "new_proposal";
  }
}

export class TransactionRejectionProposedTrigger extends QueuedTransactionTriggerBase {
  filterEvent(e: SafeEvent): boolean {
    return e.type === "new_rejection";
  }
}

export class TransactionNewConfirmationTrigger extends QueuedTransactionTriggerBase {
  filterEvent(e: SafeEvent): boolean {
    return e.type === "new_confirmation" && e.payload.type !== "rejection";
  }
}

export class TransactionRejectionNewConfirmationTrigger extends QueuedTransactionTriggerBase {
  filterEvent(e: SafeEvent): boolean {
    return e.type === "new_confirmation" && e.payload.type === "rejection";
  }
}
