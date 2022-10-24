import { ConnectorInput, ConnectorOutput } from "grindery-nexus-common-utils/dist/connector";
import { TransactionConfig } from "web3-core";
import { parseFunctionDeclaration } from "./utils";
import { getWeb3 } from "./web3";
import { encodeExecTransaction, execTransactionAbi } from "./gnosisSafe";
import { hmac, parseUserAccessToken, TAccessToken } from "../../jwt";
import axios, { AxiosResponse } from "axios";
import Web3 from "web3";
import mutexify from "mutexify/promise";

import GrinderyNexusDrone from "./abi/GrinderyNexusDrone.json";
import GrinderyNexusHub from "./abi/GrinderyNexusHub.json";

const HUB_ADDRESS = "0xC942DFb6cC8Aade0F54e57fe1eD4320411625F8B";

const hubAvailability = new Map<string, boolean>();

function onlyOnce(fn: () => void): () => void {
  let called = false;
  return () => {
    if (called) {
      return;
    }
    called = true;
    fn();
  };
}
const safeMutexify = () => {
  const mutex = mutexify();
  return async () => onlyOnce(await mutex());
};

const transactionMutexes: { [contractAddress: string]: () => Promise<() => void> } = {};

async function isHubAvailable(chain: string, web3: Web3) {
  if (!hubAvailability.has(chain)) {
    const code = await web3.eth.getCode(HUB_ADDRESS).catch(() => "");
    const hasHub = !!code && code !== "0x";
    console.log(`isHubAvailable: ${chain} -> ${hasHub}`);
    hubAvailability.set(chain, hasHub);
  }
  return hubAvailability.get(chain) as boolean;
}

async function prepareRoutedTransaction<T extends Partial<TransactionConfig> | TransactionConfig>(
  tx: T,
  userAddress: string,
  chain: string,
  web3: Web3
): Promise<{ tx: T; droneAddress: string | null }> {
  if (!web3.utils.isAddress(userAddress)) {
    throw new Error("userAddress is not an valid address");
  }
  if (!tx.to || !tx.from || !tx.data) {
    throw new Error("Invalid tx");
  }
  if (!(await isHubAvailable(chain, web3))) {
    return { tx, droneAddress: null };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hubContract = new web3.eth.Contract(GrinderyNexusHub as any, HUB_ADDRESS);
  const droneAddress = await hubContract.methods.getUserDroneAddress(userAddress).call();
  const code = await web3.eth.getCode(droneAddress).catch(() => "");
  const hasDrone = !!code && code !== "0x";
  let nonce = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const droneContract = new web3.eth.Contract(GrinderyNexusDrone as any, droneAddress);
  if (hasDrone) {
    nonce = await droneContract.methods.getNextNonce().call();
  }
  const transactionHash = await hubContract.methods.getTransactionHash(droneAddress, tx.to, nonce, tx.data).call();
  const signature = await web3.eth.sign(transactionHash, tx.from);
  tx = { ...tx };
  if (hasDrone) {
    tx.data = droneContract.methods.sendTransaction(tx.to, nonce, tx.data, signature).encodeABI();
    tx.to = droneAddress;
  } else {
    tx.data = hubContract.methods.deployDroneAndSendTransaction(userAddress, tx.to, tx.data, signature).encodeABI();
    tx.to = HUB_ADDRESS;
  }
  return { tx, droneAddress };
}

async function getUserAddress(user: TAccessToken, web3: Web3) {
  let userAddress: string;
  if ("workspace" in user) {
    userAddress = web3.utils.toChecksumAddress(
      "0x" + (await hmac("grindery-web3-address-workspace/" + user.workspace)).subarray(0, 20).toString("hex")
    );
  } else {
    const addressMatch = /^eip155:\d+:(0x.+)$/.exec(user.sub || "");
    if (addressMatch) {
      userAddress = addressMatch[1];
      if (!web3.utils.isAddress(userAddress)) {
        throw new Error("Unexpected eip155 user ID format");
      }
    } else {
      userAddress = web3.utils.toChecksumAddress(
        "0x" + (await hmac("grindery-web3-address-sub/" + user.sub)).subarray(0, 20).toString("hex")
      );
    }
  }
  return userAddress;
}
export async function callSmartContract(
  input: ConnectorInput<{
    chain: string;
    contractAddress: string;
    functionDeclaration: string;
    parameters: { [key: string]: unknown };
    maxFeePerGas?: string | number;
    maxPriorityFeePerGas?: string | number;
    gasLimit?: string | number; // Note: This is in ETH instead of gas unit
    dryRun?: boolean;
    userToken: string;
  }>
): Promise<ConnectorOutput> {
  const user = await parseUserAccessToken(input.fields.userToken).catch(() => null);
  if (!user) {
    throw new Error("User token is invalid");
  }
  const { web3, close, ethersProvider } = getWeb3(input.fields.chain);
  try {
    const userAddress = await getUserAddress(user, web3);
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
    const rawTxConfig: TransactionConfig = {
      from: web3.defaultAccount,
      to: input.fields.contractAddress,
      data: callData,
    };
    const isSimulation = functionInfo.constant || functionInfo.stateMutability === "pure" || input.fields.dryRun;
    const block = await web3.eth.getBlock("pending").catch(() => web3.eth.getBlock("latest"));
    if (!transactionMutexes[input.fields.chain]) {
      transactionMutexes[input.fields.chain] = safeMutexify();
    }
    const releaseLock = isSimulation
      ? () => {
          /* Empty */
        }
      : await transactionMutexes[input.fields.chain]();
    try {
      const { tx: txConfig, droneAddress } = await prepareRoutedTransaction(
        rawTxConfig,
        userAddress,
        input.fields.chain,
        web3
      );
      let callResult, callResultDecoded;
      try {
        callResult = await web3.eth.call(txConfig);
        if (droneAddress) {
          const decoded = web3.eth.abi.decodeParameters(
            GrinderyNexusDrone.find((x) => x.name === "sendTransaction")?.outputs || [],
            callResult
          );
          if (!decoded.success) {
            await web3.eth.call({ ...rawTxConfig, from: droneAddress });
            throw new Error("Transaction failed with unknown error");
          }
          if (functionInfo.outputs?.length) {
            callResultDecoded = web3.eth.abi.decodeParameters(functionInfo.outputs || [], decoded.returnData);
            if (functionInfo.outputs.length === 1) {
              callResultDecoded = callResultDecoded[0];
            }
          }
        }
      } catch (e) {
        if (!input.fields.dryRun) {
          throw e;
        }
        return {
          key: input.key,
          sessionId: input.sessionId,
          payload: {
            _grinderyDryRunError:
              "Can't confirm that the transaction can be executed due to the following error: " + e.toString(),
          },
        };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      txConfig.nonce = web3.utils.toHex(await web3.eth.getTransactionCount(web3.defaultAccount)) as any;
      let result: unknown;
      for (const key of ["gasLimit", "maxFeePerGas", "maxPriorityFeePerGas"]) {
        if (key in input.fields && typeof input.fields[key] === "string") {
          input.fields[key] = web3.utils.toWei(input.fields[key], "ether");
        }
      }
      const gas = await web3.eth.estimateGas(txConfig);
      txConfig.gas = Math.ceil(gas * 1.1 + 10000);
      let minFee: number;
      if (block.baseFeePerGas) {
        const baseFee = Number(block.baseFeePerGas);
        minFee = baseFee + Number(web3.utils.toWei("30", "gwei"));
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
      } else {
        const gasPrice = await ethersProvider.getGasPrice();
        txConfig.gasPrice = gasPrice.toString();
        minFee = gasPrice.mul(txConfig.gas).toNumber();
      }
      if (isSimulation) {
        result = {
          returnValue: callResultDecoded,
          estimatedGas: gas,
          minFee,
        };
      } else {
        const receipt = await web3.eth.sendTransaction(txConfig);
        releaseLock(); // Block less time
        result = receipt;
        const cost = web3.utils.toBN(receipt.gasUsed).mul(web3.utils.toBN(receipt.effectiveGasPrice)).toString(10);
        if (process.env.GAS_DEBIT_WEBHOOK) {
          axios
            .post(process.env.GAS_DEBIT_WEBHOOK, {
              transaction: receipt.transactionHash,
              block: receipt.blockNumber,
              chain: input.fields.chain,
              contractAddress: input.fields.contractAddress,
              user: user.sub,
              gasCost: cost,
            })
            .catch((e) => {
              const resp = e.response as AxiosResponse;
              console.error(
                "Failed to call gas debit webhook",
                { code: resp?.status, body: resp?.data, headers: resp?.headers, config: resp?.config },
                e instanceof Error ? e : null
              );
            });
        } else {
          console.debug("Gas debit webhook is disabled");
        }
        if (droneAddress) {
          const eventAbi = GrinderyNexusDrone.find((x) => x.name === "TransactionResult");
          const eventSignature = web3.eth.abi.encodeEventSignature(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            eventAbi as any
          );
          const log = receipt.logs.find((x) => x.topics?.[0] === eventSignature && x.address === droneAddress);
          if (!log) {
            throw new Error("No transaction result log in receipt");
          }
          const resultData = web3.eth.abi.decodeLog(eventAbi?.inputs || [], log.data, log.topics.slice(1));
          if (resultData.success) {
            if (functionInfo.outputs?.length) {
              callResultDecoded = web3.eth.abi.decodeParameters(functionInfo.outputs || [], resultData.returnData);
              if (functionInfo.outputs.length === 1) {
                callResultDecoded = callResultDecoded[0];
              }
              result = { ...receipt, returnValue: callResultDecoded };
            }
          } else {
            throw new Error("Unexpected failure: " + resultData.returnData);
          }
        }
      }
      return {
        key: input.key,
        sessionId: input.sessionId,
        payload: result,
      };
    } finally {
      releaseLock();
    }
  } finally {
    close();
  }
}
