/* eslint-disable @typescript-eslint/no-unused-vars */
import { ConnectorInput, ConnectorOutput } from "grindery-nexus-common-utils/dist/connector";
import { TransactionConfig } from "web3-core";
import { getUserAddress, parseFunctionDeclaration, HUB_ADDRESS, getMetadataFromCID } from "./utils";
import { getWeb3 } from "./web3";
import { encodeExecTransaction, execTransactionAbi } from "./gnosisSafe";
import { parseUserAccessToken } from "../../jwt";
import axios, { AxiosResponse } from "axios";
import Web3 from "web3";
import mutexify from "mutexify/promise";

import GrinderyNexusDrone from "./abi/GrinderyNexusDrone.json";
import GrinderyNexusHub from "./abi/GrinderyNexusHub.json";

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
    const userAddress = await getUserAddress(user);
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

      const paramArray = [] as any[];
      functionInfo = parseFunctionDeclaration(input.fields.functionDeclaration);
      const inputs = functionInfo.inputs || [];

      // NFT minting ipfs metadata
      if (functionInfo.name === "mintNFT") {
        paramArray.push(input.fields.parameters.recipient);
        const metadata = JSON.stringify((({name, description, image}) => ({name, description, image}))(input.fields.parameters));
        const IPFS:any = await Function('return import("ipfs-core")')() as Promise<typeof import("ipfs-core")>;
        const ipfs = await IPFS.create({repo: "ok" + Math.random()});
        const cid = await ipfs.add(metadata);
        paramArray.push("ipfs://" + cid.path);
      } else {
        for (const i of inputs) {
          if (!(i.name in input.fields.parameters)) {
            throw new Error("Missing parameter " + i.name);
          }
          paramArray.push(input.fields.parameters[i.name]);
        }
      }

      callData = web3.eth.abi.encodeFunctionCall(functionInfo, paramArray);
    }

    const rawTxConfig: TransactionConfig = {
      from: web3.defaultAccount,
      to: input.fields.contractAddress,
      data: callData,
    };
    const isSimulation = functionInfo.constant || functionInfo.stateMutability === "pure" || input.fields.dryRun;
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
      console.log("userAddress", userAddress);
      const { tx: txConfig, droneAddress } = await prepareRoutedTransaction(
        rawTxConfig,
        userAddress,
        input.fields.chain,
        web3
      );
      let callResult, callResultDecoded;
      // try {
      //   callResult = await web3.eth.call(txConfig);
      //   if (droneAddress) {
      //     const decoded = web3.eth.abi.decodeParameters(
      //       GrinderyNexusDrone.find((x) => x.name === "sendTransaction")?.outputs || [],
      //       callResult
      //     );
      //     if (!decoded.success) {
      //       await web3.eth.call({ ...rawTxConfig, from: droneAddress });
      //       throw new Error("Transaction failed with unknown error");
      //     }
      //     if (functionInfo.outputs?.length) {
      //       callResultDecoded = web3.eth.abi.decodeParameters(functionInfo.outputs || [], decoded.returnData);
      //       if (functionInfo.outputs.length === 1) {
      //         callResultDecoded = callResultDecoded[0];
      //       }
      //     }
      //   }
      //   console.log("après comment")
      // } catch (e) {
      //   if (!input.fields.dryRun) {
      //     throw e;
      //   }
      //   return {
      //     key: input.key,
      //     sessionId: input.sessionId,
      //     payload: {
      //       _grinderyDryRunError:
      //         "Can't confirm that the transaction can be executed due to the following error: " + e.toString(),
      //     },
      //   };
      // }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any



      txConfig.nonce = web3.utils.toHex(await web3.eth.getTransactionCount(web3.defaultAccount)) as any;
      let result: any;
      for (const key of ["gasLimit", "maxFeePerGas", "maxPriorityFeePerGas"]) {
        if (key in input.fields && typeof input.fields[key] === "string") {
          input.fields[key] = web3.utils.toWei(input.fields[key], "ether");
        }
      }

      const gas = await web3.eth.estimateGas(txConfig);
      txConfig.gas = Math.ceil(gas * 1.1 + 100000);
      let minFee: number;
      if (input.fields.chain === "eip155:42161") {
        // Arbitrum, fixed fee
        txConfig.maxPriorityFeePerGas = 0;
        txConfig.maxFeePerGas = Number(web3.utils.toWei("110", "kwei"));
        minFee = txConfig.maxFeePerGas;
      } else if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        minFee = (feeData.lastBaseFeePerGas || feeData.maxFeePerGas.div(2)).mul(15).div(10).toNumber();
        const maxTip =
          input.fields.maxPriorityFeePerGas || Math.floor(minFee / 2);
        const maxFee = input.fields.gasLimit
          ? Math.floor(Number(input.fields.gasLimit) / txConfig.gas)
          : feeData.maxFeePerGas.add(maxTip).toNumber();
        if (maxFee < minFee) {
          throw new Error(
            `Gas limit of ${web3.utils.fromWei(
              String(input.fields.gasLimit),
              "ether"
            )} is too low, need at least ${web3.utils.fromWei(String(minFee * txConfig.gas), "ether")}`
          );
        }
        txConfig.maxFeePerGas = maxFee;
        txConfig.maxPriorityFeePerGas = Number(maxTip);
      } else {
        const gasPrice = (feeData.gasPrice || await ethersProvider.getGasPrice()).mul(12).div(10);
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

        // console.log("result: " + JSON.stringify(result))

        // if (process.env.GAS_DEBIT_WEBHOOK) {
        //   axios
        //     .post(process.env.GAS_DEBIT_WEBHOOK, {
        //       transaction: receipt.transactionHash,
        //       block: receipt.blockNumber,
        //       chain: input.fields.chain,
        //       contractAddress: input.fields.contractAddress,
        //       user: user.sub,
        //       gasCost: cost,
        //     })
        //     .catch((e) => {
        //       const resp = e.response as AxiosResponse;
        //       console.error(
        //         "Failed to call gas debit webhook",
        //         { code: resp?.status, body: resp?.data, headers: resp?.headers, config: resp?.config },
        //         e instanceof Error ? e : null
        //       );
        //     });
        // } else {
        //   console.debug("Gas debit webhook is disabled");
        // }






        // if (droneAddress) {
        //   const eventAbi = GrinderyNexusDrone.find((x) => x.name === "TransactionResult");
        //   const eventSignature = web3.eth.abi.encodeEventSignature(
        //     // eslint-disable-next-line @typescript-eslint/no-explicit-any
        //     eventAbi as any
        //   );
        //   const log = receipt.logs.find((x) => x.topics?.[0] === eventSignature && x.address === droneAddress);
        //   if (!log) {
        //     throw new Error("No transaction result log in receipt");
        //   }
        //   const resultData = web3.eth.abi.decodeLog(eventAbi?.inputs || [], log.data, log.topics.slice(1));
        //   if (resultData.success) {
        //     if (functionInfo.outputs?.length) {
        //       callResultDecoded = web3.eth.abi.decodeParameters(functionInfo.outputs || [], resultData.returnData);
        //       if (functionInfo.outputs.length === 1) {
        //         callResultDecoded = callResultDecoded[0];
        //       }
        //       result = { ...receipt, returnValue: callResultDecoded };
        //     }
        //   } else {
        //     throw new Error("Unexpected failure: " + resultData.returnData);
        //   }
        // }
      }

      let payload:any;

      if (functionInfo.name === "mintNFT") {
        payload = result.transactionHash;
      }
      console.log("end call");
      return {
        key: input.key,
        sessionId: input.sessionId,
        payload,
      };
    } finally {
      releaseLock();
    }
  } finally {
    close();
  }
}