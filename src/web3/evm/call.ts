import { ConnectorInput, ConnectorOutput } from "grindery-nexus-common-utils/dist/connector";
import { TransactionConfig, TransactionReceipt } from "web3-core";
import { getUserAddress, parseFunctionDeclaration, HUB_ADDRESS } from "./utils";
import { getWeb3 } from "./web3";
import { encodeExecTransaction, execTransactionAbi } from "./gnosisSafe";
import { parseUserAccessToken } from "../../jwt";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import Web3 from "web3";
import mutexify from "mutexify/promise";
import { BigNumber } from "@ethersproject/bignumber";
import GrinderyNexusDrone from "./abi/GrinderyNexusDrone.json";
import GrinderyNexusHub from "./abi/GrinderyNexusHub.json";
import vaultSigner from "./signer";
import { AbiItem } from "web3-utils";

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

const transactionMutexes: {
  [contractAddress: string]: () => Promise<() => void>;
} = {};

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
  const hubContract = new web3.eth.Contract(GrinderyNexusHub as AbiItem[], HUB_ADDRESS);
  const droneAddress = await hubContract.methods.getUserDroneAddress(userAddress).call();
  const code = await web3.eth.getCode(droneAddress).catch(() => "");
  const hasDrone = !!code && code !== "0x";
  let nonce = 0;
  const droneContract = new web3.eth.Contract(GrinderyNexusDrone as AbiItem[], droneAddress);
  if (hasDrone) {
    nonce = await droneContract.methods.getNextNonce().call();
  }
  const transactionHash = await hubContract.methods.getTransactionHash(droneAddress, tx.to, nonce, tx.data).call();
  const signature = await vaultSigner.signMessage(transactionHash);
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
  const address = await vaultSigner.getAddress();
  const { web3, close, ethersProvider } = getWeb3(input.fields.chain);
  try {
    const userAddress = await getUserAddress(user);
    web3.eth.transactionConfirmationBlocks = 1;
    if (!web3.defaultAccount) {
      web3.eth.defaultAccount = address;
      web3.defaultAccount = address;
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
      from: address,
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
          const decoded = web3.eth.abi.decodeParameters(
            GrinderyNexusDrone.find((x) => x.name === "sendTransaction")?.outputs || [],
            callResult
          );
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

      const gas = BigNumber.from(await web3.eth.estimateGas(txConfig));
      txConfig.gas = gas.mul(11).div(10).add(50000).toHexString();
      let minFee: BigNumber;
      if (input.fields.chain === "eip155:42161") {
        // Arbitrum, fixed fee
        txConfig.maxPriorityFeePerGas = 0;
        txConfig.maxFeePerGas = BigNumber.from(web3.utils.toWei("110", "kwei")).toHexString();
        minFee = BigNumber.from(txConfig.maxFeePerGas);
      } else if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        minFee = (feeData.lastBaseFeePerGas || feeData.maxFeePerGas.div(2)).mul(15).div(10);
        const maxTip = BigNumber.from(input.fields.maxPriorityFeePerGas || minFee.div(2));
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
        const gasPrice = (feeData.gasPrice || (await ethersProvider.getGasPrice())).mul(12).div(10);
        txConfig.gasPrice = gasPrice.toHexString();
        minFee = gasPrice.mul(txConfig.gas);
      }

      if (isSimulation) {
        result = {
          returnValue: callResultDecoded,
          estimatedGas: gas.toString(),
          minFee: minFee.toString(),
        };
      } else {
        const signedTransaction = await vaultSigner.signTransaction({
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
                maxFeePerGas: txConfig.maxFeePerGas ? BigNumber.from(txConfig.maxFeePerGas).toHexString() : undefined,
                maxPriorityFeePerGas: txConfig.maxPriorityFeePerGas
                  ? BigNumber.from(txConfig.maxPriorityFeePerGas).toHexString()
                  : undefined,
              }
            : {
                gasPrice: txConfig.gasPrice ? BigNumber.from(txConfig.gasPrice).toHexString() : undefined,
              }),
        });
        const receipt = await web3.eth.sendSignedTransaction(signedTransaction);
        releaseLock(); // Block less time
        result = receipt;
        const cost = BigNumber.from(receipt.gasUsed || txConfig.gas)
          .mul(BigNumber.from(receipt.effectiveGasPrice || txConfig.gasPrice || txConfig.maxFeePerGas))
          .toString();

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
              result = {
                ...receipt,
                returnValue: callResultDecoded,
                contractAddress: input.fields.contractAddress,
              };
              console.log("result", result);
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
