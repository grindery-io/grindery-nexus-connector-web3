import Web3 from "web3";
import { AbiItem } from "web3-utils";
import { BlockTransactionObject } from "web3-eth";
import { getWeb3 } from "./web3";
import { hmac, TAccessToken } from "../../jwt";
import { CHAIN_MAPPING } from "./chains";

export const HUB_ADDRESS = process.env.EVM_HUB_ADDRESS || "0xC942DFb6cC8Aade0F54e57fe1eD4320411625F8B";

export function onNewBlockMultiChain(
  chains: string | string[],
  callback: (params: {
    chain: string;
    web3: Web3;
    block: BlockTransactionObject;
    ethersProvider: ReturnType<typeof getWeb3>["ethersProvider"];
    memoCall: <T>(key: string, call: () => T) => T;
  }) => Promise<void>,
  onError: (e: Error) => void
): () => void {
  if (chains.length === 0) {
    throw new Error("No chains specified");
  }
  if (typeof chains === "string") {
    chains = [chains];
  }
  const cleanUpFunctions = [] as (() => void)[];
  if (!chains.some((x) => CHAIN_MAPPING[x])) {
    throw new Error("None of the chains are supported: " + chains.join(","));
  }
  for (const chain of chains) {
    if (!CHAIN_MAPPING[chain]) {
      console.warn("Unsupported chain:", chain);
      continue;
    }
    const { web3, close, onNewBlock, web3Wrapper, ethersProvider } = getWeb3(chain);
    const onClose = () => {
      onError(new Error(`Web3Wrapper for ${chain} closed`));
    };
    web3Wrapper.on("close", onClose);
    cleanUpFunctions.push(() => {
      web3Wrapper.off("close", onClose);
    });
    cleanUpFunctions.push(
      onNewBlock(
        // eslint-disable-next-line n/no-callback-literal
        (block, memoCall) => Promise.resolve(callback({ chain, web3, block, ethersProvider, memoCall })).catch(onError),
        onError
      )
    );
    cleanUpFunctions.push(close);
  }
  return () => {
    for (const cleanUpFunction of cleanUpFunctions) {
      cleanUpFunction();
    }
    cleanUpFunctions.splice(0, cleanUpFunctions.length);
  };
}
export function isSameAddress(a: string | null, b: string | null): boolean {
  return !!a && !!b && (/^0x/.test(a) && /^0x/.test(b) ? a.toLowerCase() === b.toLowerCase() : a === b);
}
export function parseEventDeclaration(eventDeclaration: string): AbiItem {
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
export function parseFunctionDeclaration(functionDeclaration: string): AbiItem {
  const m = /^\s*(function +)?([a-zA-Z0-9_]+)\s*\(([^)]+)?\)\s*(.*)$/.exec(functionDeclaration);
  if (!m) {
    throw new Error("Invalid function declaration");
  }
  const name = m[2];
  const inputs = m[3]
    ? m[3].split(",").map((p) => {
        const parts = p.trim().split(/\s+/);
        if (parts.length < 2) {
          throw new Error("Invalid function declaration: Invalid parameter " + p);
        }
        return {
          type: parts[0],
          name: parts[parts.length - 1],
        };
      })
    : [];
  const returnMatch = /\breturns\s+\(([^)]+)\)/.exec(m[4]) || /\breturns\s+([^\s]+)/.exec(m[4]);
  const outputs = returnMatch
    ? returnMatch[1].split(",").map((p, index) => {
        const parts = p.trim().split(/\s+/);
        return {
          type: parts[0],
          name: parts[1] || `return${index}`,
        };
      })
    : [];
  const suffixes = m[4].trim().split(/\s+/);
  return {
    name,
    inputs,
    outputs,
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

export async function getUserAddress(user: TAccessToken) {
  let userAddress: string;
  if ("workspace" in user) {
    userAddress = Web3.utils.toChecksumAddress(
      "0x" + (await hmac("grindery-web3-address-workspace/" + user.workspace)).subarray(0, 20).toString("hex")
    );
  } else {
    const addressMatch = /^eip155:\d+:(0x.+)$/.exec(user.sub || "");
    if (addressMatch) {
      userAddress = addressMatch[1];
      if (!Web3.utils.isAddress(userAddress)) {
        throw new Error("Unexpected eip155 user ID format");
      }
    } else {
      userAddress = Web3.utils.toChecksumAddress(
        "0x" + (await hmac("grindery-web3-address-sub/" + user.sub)).subarray(0, 20).toString("hex")
      );
    }
  }
  return userAddress;
}
