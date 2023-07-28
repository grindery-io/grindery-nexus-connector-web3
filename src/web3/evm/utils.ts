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

/**
 * Parses an event declaration and extracts relevant information.
 * @param eventDeclaration - The event declaration string to parse.
 * @returns An object representing the parsed event declaration (AbiItem).
 * @throws Error if the event declaration is invalid or contains invalid parameters.
 */
export function parseEventDeclaration(eventDeclaration: string): AbiItem {
  const eventParts = /^\s*(event +)?([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*;?\s*$/.exec(eventDeclaration);
  if (!eventParts) {
    throw new Error("Invalid event declaration");
  }

  return {
    name: eventParts[2],
    inputs: eventParts[3].split(",").map((p) => {
      const inputParts = p.trim().split(/\s+/);
      if (
        (inputParts.length !== 2 && inputParts.length !== 3) ||
        (inputParts.length === 3 && inputParts[1] !== "indexed")
      ) {
        throw new Error("Invalid event declaration: Invalid parameter " + p.trim());
      }
      return { indexed: inputParts.length === 3, type: inputParts[0], name: inputParts[inputParts.length - 1] };
    }),
    type: "event",
    anonymous: false,
  };
}

/**
 * Parses a function declaration and extracts relevant information.
 * @param functionDeclaration - The function declaration string to parse.
 * @returns An object representing the parsed function declaration (AbiItem).
 * @throws Error if the function declaration is invalid or contains invalid parameters.
 */
export function parseFunctionDeclaration(functionDeclaration: string): AbiItem {
  const functionParts = /^\s*(function +)?([a-zA-Z0-9_]+)\s*\(([^)]+)?\)\s*(.*)$/.exec(functionDeclaration);
  if (!functionParts) {
    throw new Error("Invalid function declaration");
  }

  const returnMatch = /\breturns\s+\(([^)]+)\)/.exec(functionParts[4]) || /\breturns\s+([^\s]+)/.exec(functionParts[4]);
  const suffixes = functionParts[4].trim().split(/\s+/);

  return {
    name: functionParts[2],
    inputs: functionParts[3]
      ? functionParts[3].split(",").map((p) => {
          const inputParts = p.trim().split(/\s+/);
          if (inputParts.length < 2) {
            throw new Error("Invalid function declaration: Invalid parameter " + p.trim());
          }
          return {
            type: inputParts[0],
            name: inputParts[inputParts.length - 1],
          };
        })
      : [],
    outputs: returnMatch
      ? returnMatch[1].split(",").map((p, index) => {
          const outputParts = p.trim().split(/\s+/);
          return {
            type: outputParts[0],
            name: outputParts[1] || `return${index}`,
          };
        })
      : [],
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
