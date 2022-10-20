import { ConnectorInput, ConnectorOutput } from "grindery-nexus-common-utils/dist/connector";
import { TransactionConfig } from "web3-core";
import { parseFunctionDeclaration } from "./utils";
import { getWeb3 } from "./web3";
import { encodeExecTransaction, execTransactionAbi } from "../gnosisSafe";
import { parseUserAccessToken } from "../../jwt";
import axios, { AxiosResponse } from "axios";

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
    userToken: string;
  }>
): Promise<ConnectorOutput> {
  const user = await parseUserAccessToken(input.fields.userToken).catch(() => null);
  const { web3, close } = getWeb3(input.fields.chain);
  try {
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
    const txConfig: TransactionConfig = {
      from: web3.defaultAccount,
      to: input.fields.contractAddress,
      data: callData,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nonce: web3.utils.toHex(await web3.eth.getTransactionCount(web3.defaultAccount)) as any,
    };
    let result: unknown;
    for (const key of ["gasLimit", "maxFeePerGas", "maxPriorityFeePerGas"]) {
      if (key in input.fields && typeof input.fields[key] === "string") {
        input.fields[key] = web3.utils.toWei(input.fields[key], "ether");
      }
    }
    const gas = await web3.eth.estimateGas(txConfig);
    txConfig.gas = Math.ceil(gas * 1.1 + 1000);
    const block = await web3.eth.getBlock("pending");
    const baseFee = Number(block.baseFeePerGas);
    const minFee = baseFee + Number(web3.utils.toWei("30", "gwei"));
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
    if (functionInfo.constant || functionInfo.stateMutability === "pure" || input.fields.dryRun) {
      let returnValue;
      try {
        returnValue = await web3.eth.call(txConfig);
        result = {
          returnValue,
          estimatedGas: gas,
          minFee,
        };
      } catch (e) {
        if (!input.fields.dryRun) {
          throw e;
        }
        result = {
          _grinderyDryRunError:
            "Can't confirm that the transaction can be executed due to the following error: " + e.toString(),
        };
      }
    } else {
      if (!user) {
        throw new Error("User token is invalid");
      }
      const receipt = await web3.eth.sendTransaction(txConfig);
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
    }
    return {
      key: input.key,
      sessionId: input.sessionId,
      payload: result,
    };
  } finally {
    close();
  }
}
