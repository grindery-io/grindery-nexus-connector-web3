import { ConnectorInput, ConnectorOutput } from "grindery-nexus-common-utils/dist/connector";
import { TransactionConfig, TransactionReceipt } from "web3-core";
import { getUserAddress, parseFunctionDeclaration, HUB_ADDRESS } from "./utils";
import { getWeb3 } from "./web3";
import { encodeExecTransaction, execTransactionAbi } from "./gnosisSafe";
import { parseUserAccessToken } from "../../jwt";
import axios, { AxiosResponse } from "axios";
import Web3 from "web3";
import mutexify from "mutexify/promise";
import { BigNumber } from "@ethersproject/bignumber";
import GrinderyNexusDrone from "./abi/GrinderyNexusDrone.json";
import GrinderyNexusHub from "./abi/GrinderyNexusHub.json";
import vaultSigner from "./signer";
import { AbiItem } from "web3-utils";
import AbiCoder from "web3-eth-abi";
import { TransactionResponse } from "@ethersproject/abstract-provider";
import { ACCOUNTING_SIMPLE_ACTIONS } from "../../utils";
import { CHAIN_MAPPING_ACCOUNTING, DEFAULT_TX_COST_RATE } from "./chains";

export const hubAvailability = new Map<string, boolean>();

/**
 * Wraps a given function so that it can only be executed once. Subsequent calls to the returned function
 * will have no effect.
 *
 * @param {Function} fn - The function to be wrapped and executed only once.
 * @returns {Function} - A new function that can only be executed once.
 */
export function onlyOnce(fn: () => void): () => void {
  let called = false;
  return () => {
    if (called) {
      return;
    }
    called = true;
    fn();
  };
}

/**
 * Creates a mutex (mutual exclusion) function that ensures only one asynchronous operation
 * can be executed at a time. It uses the `mutexify` library to create the mutex.
 */
const safeMutexify = () => {
  const mutex = mutexify();
  return async () => onlyOnce(await mutex());
};

const transactionMutexes: {
  [contractAddress: string]: () => Promise<() => void>;
} = {};

/**
 * Checks if the Grindery Nexus Hub is available on the specified chain.
 *
 * @param {string} chain - The chain identifier.
 * @param {Web3} web3 - The Web3 instance to interact with the blockchain.
 * @returns {Promise<boolean>} - A Promise that resolves to a boolean value indicating whether the Grindery Nexus Hub is available on the specified chain.
 */
export async function isHubAvailable(chain: string, web3: Web3): Promise<boolean> {
  if (!hubAvailability.has(chain)) {
    const code = await web3.eth.getCode(HUB_ADDRESS).catch(() => "");
    const hasHub = !!code && code !== "0x";
    console.log(`isHubAvailable: ${chain} -> ${hasHub}`);
    hubAvailability.set(chain, hasHub);
  }
  return hubAvailability.get(chain) as boolean;
}

/**
 * Decodes the call result of a drone contract's `sendTransaction` function call.
 *
 * @param {string} callResult - The result of the `sendTransaction` function call as a hexadecimal string.
 * @returns {any[]} - An array containing the decoded parameters from the call result.
 */
export function decodeDroneCallResult(callResult: string) {
  return AbiCoder.decodeParameters(
    GrinderyNexusDrone.find((x) => x.name === "sendTransaction")?.outputs || [],
    callResult
  );
}

/**
 * Prepares a routed transaction based on the provided parameters.
 *
 * @template T - Type of the transaction config.
 * @param {T} tx - The transaction config object. It should include `to`, `from`, and `data` properties.
 * @param {string} userAddress - The user's Ethereum address.
 * @param {string} chain - The chain identifier.
 * @param {Web3} web3 - The Web3 instance to interact with the blockchain.
 * @returns {Promise<{ tx: T; droneAddress: string | null }>} - A Promise that resolves to an object containing the prepared transaction (`tx`) and the drone address (`droneAddress`).
 * @throws {Error} - If `userAddress` is not a valid Ethereum address or if the `tx` object is invalid.
 */
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
  const hubContract = new web3.eth.Contract(GrinderyNexusHub as AbiItem[], HUB_ADDRESS);
  const droneAddress = await hubContract.methods.getUserDroneAddress(userAddress).call();
  const code = await web3.eth.getCode(droneAddress).catch(() => "");
  const hasDrone = !!code && code !== "0x";
  const droneContract = new web3.eth.Contract(GrinderyNexusDrone as AbiItem[], droneAddress);
  const nonce = hasDrone ? await droneContract.methods.getNextNonce().call() : 0;
  const signature = await vaultSigner.signMessage(
    await hubContract.methods.getTransactionHash(droneAddress, tx.to, nonce, tx.data).call()
  );
  return {
    tx: {
      ...tx,
      data: hasDrone
        ? droneContract.methods.sendTransaction(tx.to, nonce, tx.data, signature).encodeABI()
        : hubContract.methods.deployDroneAndSendTransaction(userAddress, tx.to, tx.data, signature).encodeABI(),
      to: hasDrone ? droneAddress : HUB_ADDRESS,
    },
    droneAddress,
  };
}

/**
 * Calls a smart contract function on the specified chain with the given input parameters.
 *
 * @param {ConnectorInput} input - An object containing input parameters for the smart contract call.
 * @returns {Promise<ConnectorOutput>} - A Promise that resolves to an object containing the result of the smart contract call.
 */
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
    userToken?: string;
    _grinderyUserToken?: string;
  }>
): Promise<ConnectorOutput> {
  if (!input.fields._grinderyUserToken) {
    console.warn("_grinderyUserToken is not available");
  }
  const user = await parseUserAccessToken(input.fields._grinderyUserToken || input.fields.userToken || "").catch(
    () => null
  );
  if (!user) {
    throw new Error("User token is invalid");
  }
  console.log(`[${input.fields.chain}] ${input.fields.functionDeclaration} -> ${input.fields.contractAddress}`);
  const fromAddress = await vaultSigner.getAddress();
  const { web3, close, ethersProvider } = getWeb3(input.fields.chain);
  try {
    const userAddress = await getUserAddress(user);
    web3.eth.transactionConfirmationBlocks = 1;
    if (!web3.defaultAccount) {
      web3.eth.defaultAccount = fromAddress;
      web3.defaultAccount = fromAddress;
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
          payload: {
            ...result,
            _grinderyAccounting: {
              result: BigNumber.from(ACCOUNTING_SIMPLE_ACTIONS)
                .mul(BigNumber.from(CHAIN_MAPPING_ACCOUNTING[input.fields.chain] || DEFAULT_TX_COST_RATE))
                .toString(),
              chain: input.fields.chain,
            },
          },
        };
      }
    } else {
      const paramArray = [] as string[];
      functionInfo = parseFunctionDeclaration(input.fields.functionDeclaration);
      const inputs = functionInfo.inputs || [];

      // NFT minting ipfs metadata
      if (functionInfo.name === "mintNFT" || functionInfo.name === "mintNFTs") {
        paramArray.push((input.fields.parameters as { [key: string]: string }).recipient);
        try {
          const res = await axios({
            method: "post",
            url: "https://api.pinata.cloud/pinning/pinJSONToIPFS",
            headers: {
              "Content-Type": "application/json",
              pinata_api_key: process.env.PINATA_API_KEY || "",
              pinata_secret_api_key: process.env.PINATA_API_SECRET || "",
            },
            data: JSON.stringify(
              (({ name, description, image }) => ({ name, description, image }))(input.fields.parameters)
            ),
          });
          paramArray.push("ipfs://" + res.data.IpfsHash);
        } catch (e) {
          console.error("Failed to pin JSON to IPFS via Pinata: ", e);
          throw e;
        }
      } else {
        for (const i of inputs) {
          if (!(i.name in input.fields.parameters)) {
            throw new Error("Missing parameter " + i.name);
          }
          paramArray.push((input.fields.parameters as { [key: string]: string })[i.name]);
        }
      }

      callData = web3.eth.abi.encodeFunctionCall(functionInfo, paramArray);
    }

    const rawTxConfig: TransactionConfig = {
      from: fromAddress,
      to: input.fields.contractAddress,
      data: callData,
    };
    const isPureFunction = functionInfo.constant || functionInfo.stateMutability === "pure";
    const isSimulation = isPureFunction || input.fields.dryRun;
    const feeData = await ethersProvider.getFeeData();
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
      let callResultDecoded;
      try {
        const callResult = await web3.eth.call(txConfig);
        if (droneAddress) {
          const decoded = decodeDroneCallResult(callResult);
          if (!decoded.success) {
            await web3.eth.call({ ...rawTxConfig, from: droneAddress });
            throw new Error("Transaction failed with unknown error");
          }
          if (functionInfo.outputs?.length) {
            if (decoded.returnData && (decoded.returnData.toLowerCase?.() || "0x") !== "0x") {
              callResultDecoded = web3.eth.abi.decodeParameters(functionInfo.outputs || [], decoded.returnData);
              if (functionInfo.outputs.length === 1) {
                callResultDecoded = callResultDecoded[0];
              }
            } else {
              throw new Error(
                "Empty result returned from function, please confirm that you have selected correct chain and entered correct contract address."
              );
            }
          }
        }
      } catch (e) {
        if (!input.fields.dryRun || isPureFunction) {
          throw e;
        }
        return {
          key: input.key,
          sessionId: input.sessionId,
          payload: {
            _grinderyDryRunError:
              "Can't confirm that the transaction can be executed due to the following error: " + e.toString(),
            _grinderyAccounting: {
              result: BigNumber.from(ACCOUNTING_SIMPLE_ACTIONS)
                .mul(BigNumber.from(CHAIN_MAPPING_ACCOUNTING[input.fields.chain] || DEFAULT_TX_COST_RATE))
                .toString(),
              chain: input.fields.chain,
            },
          },
        };
      }
      txConfig.nonce = await web3.eth.getTransactionCount(fromAddress);
      let result: unknown;
      for (const key of ["gasLimit", "maxFeePerGas", "maxPriorityFeePerGas"]) {
        if (key in input.fields && typeof input.fields[key] === "string") {
          input.fields[key] = web3.utils.toWei(input.fields[key], "ether");
        }
      }

      let gas = BigNumber.from(
        await web3.eth.estimateGas({ gas: BigNumber.from(8000000).toHexString(), gasPrice: "0x0", ...txConfig })
      );
      let minGas = gas;
      // eslint-disable-next-line no-inner-declarations
      async function probeGas(gas: BigNumber) {
        txConfig.nonce = await web3.eth.getTransactionCount(fromAddress);
        const result = await web3.eth.call({ gas: gas.toHexString(), gasPrice: "0x0", ...txConfig });
        if (droneAddress) {
          const decoded = decodeDroneCallResult(result);
          if (!decoded.success) {
            throw new Error("Incorrect gas, bump up");
          }
        }
      }
      for (;;) {
        if (gas.gt("30000000")) {
          throw new Error("Unable to estimate gas");
        }
        try {
          await probeGas(gas);
          break;
        } catch (e) {
          minGas = gas;
          gas = gas.mul(15).div(10);
        }
      }
      for (;;) {
        const diff = gas.sub(minGas);
        if (diff.lte(10000)) {
          break;
        }
        const downGas = gas.sub(diff.div(2));
        try {
          await probeGas(downGas);
          gas = downGas;
        } catch (e) {
          minGas = downGas;
        }
      }
      txConfig.gas = gas.mul(11).div(10).toHexString();
      let minFee: BigNumber;
      if (input.fields.chain === "eip155:42161") {
        // Arbitrum, fixed fee
        txConfig.maxPriorityFeePerGas = 0;
        txConfig.maxFeePerGas = BigNumber.from(web3.utils.toWei("110", "kwei")).toHexString();
        minFee = BigNumber.from(txConfig.maxFeePerGas);
      } else if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        minFee = (feeData.lastBaseFeePerGas || feeData.maxFeePerGas.div(2)).mul(15).div(10);
        const maxTip = BigNumber.from(
          input.fields.maxPriorityFeePerGas ||
            (feeData.maxPriorityFeePerGas || minFee.div(2)).add(web3.utils.toWei("10", "gwei"))
        );
        const maxFee = input.fields.gasLimit
          ? BigNumber.from(input.fields.gasLimit).div(txConfig.gas)
          : feeData.maxFeePerGas.add(maxTip);
        if (minFee.gt(maxFee)) {
          throw new Error(
            `Gas limit of ${web3.utils.fromWei(
              String(input.fields.gasLimit),
              "ether"
            )} is too low, need at least ${web3.utils.fromWei(minFee.mul(txConfig.gas || 1).toString(), "ether")}`
          );
        }
        txConfig.maxFeePerGas = maxFee.toHexString();
        txConfig.maxPriorityFeePerGas = maxTip.toHexString();
      } else {
        const refPrice1 = BigNumber.from(feeData.gasPrice || (await ethersProvider.getGasPrice()));
        const refTxes = [] as TransactionResponse[];
        let blockNumber = await ethersProvider.getBlockNumber();
        while (refTxes.length < 10) {
          const block = await ethersProvider.getBlockWithTransactions(blockNumber);
          refTxes.push(...block.transactions);
          blockNumber--;
        }
        refTxes.sort((a, b) =>
          BigNumber.from(a.gasPrice || 0)
            .sub(b.gasPrice || 0)
            .toNumber()
        );
        const refPrice2 = refTxes[refTxes.length >> 1].gasPrice || 0;
        const gasPrice = BigNumber.from(refPrice1.gt(refPrice2) ? refPrice1 : refPrice2)
          .mul(12)
          .div(10);
        txConfig.gasPrice = gasPrice.toHexString();
        minFee = gasPrice.mul(txConfig.gas);
      }

      if (isSimulation) {
        result = {
          returnValue: callResultDecoded,
          estimatedGas: gas.toString(),
          minFee: minFee.toString(),
          ...(isPureFunction
            ? {}
            : {
                transactionHash: "0x1122334455667788990011223344556677889900112233445566778899001122",
              }),
          contractAddress: input.fields.contractAddress,
          _grinderyAccounting: {
            result: BigNumber.from(ACCOUNTING_SIMPLE_ACTIONS)
              .mul(BigNumber.from(CHAIN_MAPPING_ACCOUNTING[input.fields.chain] || DEFAULT_TX_COST_RATE))
              .toString(),
            chain: input.fields.chain,
          },
        };
      } else {
        const maxFee = input.fields.gasLimit
          ? BigNumber.from(input.fields.gasLimit)
          : BigNumber.from(txConfig.gasPrice || txConfig.maxFeePerGas).mul(5);
        web3.eth.transactionPollingTimeout = 45;
        let receipt: TransactionReceipt;
        for (;;) {
          try {
            receipt = await web3.eth.sendSignedTransaction(
              await vaultSigner.signTransaction({
                from: txConfig.from?.toString(),
                to: txConfig.to,
                data: txConfig.data,
                value: txConfig.value ? BigNumber.from(txConfig.value).toHexString() : undefined,
                nonce: txConfig.nonce,
                chainId: await web3.eth.getChainId(),
                gasLimit: txConfig.gas ? BigNumber.from(txConfig.gas).toHexString() : undefined,
                ...(txConfig.maxFeePerGas
                  ? {
                      type: 2,
                      maxFeePerGas: txConfig.maxFeePerGas
                        ? BigNumber.from(txConfig.maxFeePerGas).toHexString()
                        : undefined,
                      maxPriorityFeePerGas: txConfig.maxPriorityFeePerGas
                        ? BigNumber.from(txConfig.maxPriorityFeePerGas).toHexString()
                        : undefined,
                    }
                  : {
                      gasPrice: txConfig.gasPrice ? BigNumber.from(txConfig.gasPrice).toHexString() : undefined,
                    }),
              })
            );
            break;
          } catch (e) {
            const errorStr: string = e.toString();
            if (!errorStr.includes("Transaction was not mined within") && !errorStr.includes("underprice")) {
              throw e;
            }
            if (
              BigNumber.from(txConfig.gasPrice || 0).eq(0) &&
              (BigNumber.from(txConfig.maxFeePerGas || 0).eq(0) ||
                BigNumber.from(txConfig.maxPriorityFeePerGas || 0).eq(0))
            ) {
              throw e;
            }
            console.log(
              `Bumping price (from: ${[txConfig.gasPrice, txConfig.maxFeePerGas, txConfig.maxPriorityFeePerGas].join(
                " / "
              )})`
            );
            if (txConfig.gasPrice) {
              txConfig.gasPrice = BigNumber.from(txConfig.gasPrice).mul(12).div(10).toHexString();
            }
            if (txConfig.maxFeePerGas) {
              txConfig.maxFeePerGas = BigNumber.from(txConfig.maxFeePerGas).mul(12).div(10).toHexString();
            }
            if (txConfig.maxPriorityFeePerGas) {
              txConfig.maxPriorityFeePerGas = BigNumber.from(txConfig.maxPriorityFeePerGas)
                .mul(12)
                .div(10)
                .toHexString();
            }
            if (BigNumber.from(txConfig.gasPrice || txConfig.maxFeePerGas).gt(maxFee)) {
              throw new Error("Can't submit tx within fee limit");
            }
          }
        }
        releaseLock(); // Block less time
        result = receipt;
        if (process.env.GAS_DEBIT_WEBHOOK) {
          axios
            .post(process.env.GAS_DEBIT_WEBHOOK, {
              transaction: receipt.transactionHash,
              block: receipt.blockNumber,
              chain: input.fields.chain,
              contractAddress: input.fields.contractAddress,
              user: user.sub,
              gasCost: BigNumber.from(receipt.gasUsed || txConfig.gas)
                .mul(BigNumber.from(receipt.effectiveGasPrice || txConfig.gasPrice || txConfig.maxFeePerGas))
                .toString(),
            })
            .catch((e) => {
              const resp = e.response as AxiosResponse;
              console.error(
                "Failed to call gas debit webhook",
                {
                  code: resp?.status,
                  body: resp?.data,
                  headers: resp?.headers,
                  config: resp?.config,
                },
                e instanceof Error ? e : null
              );
            });
        } else {
          console.debug("Gas debit webhook is disabled");
        }

        if (droneAddress) {
          const eventAbi = GrinderyNexusDrone.find((x) => x.name === "TransactionResult");
          const eventSignature = web3.eth.abi.encodeEventSignature(eventAbi as AbiItem);
          const log = receipt.logs.find((x) => x.topics?.[0] === eventSignature && x.address === droneAddress);
          if (!log) {
            throw new Error("No transaction result log in receipt");
          }
          const resultData = web3.eth.abi.decodeLog(eventAbi?.inputs || [], log.data, log.topics.slice(1));
          if (resultData.success && functionInfo.outputs?.length) {
            callResultDecoded = web3.eth.abi.decodeParameters(functionInfo.outputs || [], resultData.returnData);
            if (functionInfo.outputs.length === 1) {
              callResultDecoded = callResultDecoded[0];
            }
            result = {
              ...receipt,
              returnValue: callResultDecoded,
              contractAddress: input.fields.contractAddress,
              _grinderyAccounting: BigNumber.from(receipt.gasUsed || txConfig.gas)
                .mul(BigNumber.from(receipt.effectiveGasPrice || txConfig.gasPrice || txConfig.maxFeePerGas))
                .toString(),
            };
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
