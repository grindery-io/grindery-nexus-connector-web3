import { ConnectorInput, ConnectorOutput } from "grindery-nexus-common-utils/dist/connector";
import { TransactionConfig } from "web3-core";
import { getUserAddress, parseFunctionDeclaration, HUB_ADDRESS, getMetadataFromCID } from "./utils";
import { getWeb3 } from "./web3";
import { encodeExecTransaction, execTransactionAbi } from "./gnosisSafe";
import { parseUserAccessToken } from "../../jwt";
// import axios, { AxiosResponse } from "axios";
import Web3 from "web3";
import mutexify from "mutexify/promise";

var axios = require('axios');

import GrinderyNexusDrone from "./abi/GrinderyNexusDrone.json";
import GrinderyNexusHub from "./abi/GrinderyNexusHub.json";
import ERC20 from "./abi/ERC20.json";


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


    /* A function that returns the balance of an address. */
    if (input.fields.functionDeclaration === "getBalanceNative") {

      const address: any = input.fields.parameters.address;
      const balance = await web3.eth.getBalance(address).then(result => web3.utils.fromWei(result));

      return {
        key: input.key,
        sessionId: input.sessionId,
        payload: {balance: balance},
      };

    }
    
    /* The above code is a TypeScript function that is executed when the functionDeclaration is
    getBalance. It takes the contractAddress and address from the input and uses them to call the
    balanceOf() function on the contract. It then returns the balance in the payload. */
    if (input.fields.functionDeclaration === "getBalanceERC20Token") {

      const tokenAddress: any = input.fields.contractAddress;
      const tokenHolder: any = input.fields.parameters.address;
      const balanceOfAbi:any = ERC20;

      // Define the ERC-20 token contract
      const contract = new web3.eth.Contract(balanceOfAbi, tokenAddress) 

      // Execute balanceOf() to retrieve the token balance
      const balanceWei = await contract.methods.balanceOf(tokenHolder).call();
      const decimals = await contract.methods.decimals().call();
      const balanceTokenUnit = balanceWei * 10 ** -decimals;

      console.log(balanceTokenUnit.toString())

      return {
        key: input.key,
        sessionId: input.sessionId,
        payload: {balance: balanceTokenUnit.toString()},
      };
    }

    /* Getting the symbol, decimals and name of the token. */
    if (input.fields.functionDeclaration === "getInformationERC20Token") {

      const abiOfToken:any = ERC20;
      const tokenContract = new web3.eth.Contract(abiOfToken, input.fields.contractAddress);

      return {
        key: input.key,
        sessionId: input.sessionId,
        payload: {
          symbol: await tokenContract.methods.symbol().call(), 
          decimals: (await tokenContract.methods.decimals().call()).toString(), 
          name: await tokenContract.methods.name().call()
        },
      };

    }



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


        var config = {
          method: 'post',
          url: 'https://api.pinata.cloud/pinning/pinJSONToIPFS',
          headers: { 
            'Content-Type': 'application/json',
            'pinata_api_key': process.env.PINATA_API_KEY,
            'pinata_secret_api_key': process.env.PINATA_API_SECRET
          },
          data: metadata
        };

        const res = await axios(config);

        // console.log(res.data);



        // const IPFS:any = await Function('return import("ipfs-core")')() as Promise<typeof import('ipfs-core')>
        // let ipfs = await IPFS.create({repo: "ok" + Math.random()});         
        // const cid = await ipfs.add(metadata);
        // paramArray.push("ipfs://" + cid.path);  

        paramArray.push("ipfs://" + res.data.IpfsHash);  
 
      } else {      
        for (const i of inputs) {
          if (!(i.name in input.fields.parameters)) {
            throw new Error("Missing parameter " + i.name);
          }
          paramArray.push(input.fields.parameters[i.name]);
        }
      }

      console.log("paramArray: " + paramArray)

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
      console.log("userAddress", userAddress)
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
      txConfig.gas = Math.ceil(gas * 1.1 + 1000000);
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
        // payload = result.transactionHash

        // console.log("txhash: " + result.transactionHash.toString());


        return {
          key: input.key,
          sessionId: input.sessionId,
          payload: {transactionHash: result.transactionHash},
        };
      }


      console.log("end call")
      return {
        key: input.key,
        sessionId: input.sessionId,
        payload: payload,
      };
    } finally {
      releaseLock();
    }
  } finally {
    close();
  }
}


async function test() {

  // const tokenAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  // // const tokenAddress = "0xc0829421C1d260BD3cB3E0F06cfE2D52db2cE315";
  // const tokenHolder = "0xB201fDd90b14cc930bEc2c4E9f432bC1CA5Ad7C5"
  // const chain = "eip155:1";



  const tokenAddress = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
  // const tokenAddress = "0xc0829421C1d260BD3cB3E0F06cfE2D52db2cE315";
  const tokenHolder = "0xaf0b0000f0210d0f421f0009c72406703b50506b"
  const chain = "eip155:137";


  const { web3, close, ethersProvider } = getWeb3(chain);

  const balanceOfAbi:any = ERC20;

  console.log(balanceOfAbi);

  // Define the ERC-20 token contract
  const contract = new web3.eth.Contract(balanceOfAbi, tokenAddress) 

  // Execute balanceOf() to retrieve the token balance
  const result = await contract.methods.balanceOf(tokenHolder).call(); // 29803630997051883414242659

  // // Convert the value from Wei to Ether
  // const formattedResult = web3.utils.fromWei(result); // 29803630.997051883414242659

  // const balance = await contract.methods.balanceOf(tokenHolder).call();
  const decimals = await contract.methods.decimals().call();

  console.log(result * 10 ** -decimals);

  // console.log(await contract.methods.decimals().call())


  
}


// test();
