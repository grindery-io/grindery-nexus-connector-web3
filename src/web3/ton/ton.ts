import { ConnectorInput, ConnectorOutput } from "grindery-nexus-common-utils";
import { TAccessToken, hmac, parseUserAccessToken } from "../../jwt";
import { TriggerConstructor } from "../utils";
import { NewEventTrigger, NewTransactionTrigger } from "../evm/triggers";
import { KeyPair, getSecureRandomBytes, keyPairFromSeed, mnemonicToWalletKey } from "ton-crypto";
import { Address, TonClient, WalletContractV4, fromNano, internal } from "ton";
import { getHttpEndpoint } from "@orbs-network/ton-access";
import "dotenv/config";
import Counter from "./abi/counter";

export const Triggers = new Map<string, TriggerConstructor>([
  ["newTransaction", NewTransactionTrigger],
  ["newTransactionAsset", NewTransactionTrigger],
  ["newEvent", NewEventTrigger],
]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    _grinderyUserToken: string;
  }>
): Promise<ConnectorOutput> {
  // Verify the userToken is valid
  const user = await parseUserAccessToken(input.fields._grinderyUserToken || input.fields.userToken).catch(() => null);
  if (!user) {
    throw new Error("User token is invalid");
  }

  // Get Grindery wallet
  const grindery_key = await mnemonicToWalletKey((process.env.TON_GRINDERY_MNEMONIC || "").split(" "));
  const grindery_wallet = WalletContractV4.create({ publicKey: grindery_key.publicKey, workchain: 0 });

  // Creates user keypair from seed based on Grindery hmac
  const user_keypair = keyPairFromSeed((await hmac("grindery-ton-key/" + user.sub)).subarray(0, 32));
  const user_wallet = WalletContractV4.create({ publicKey: user_keypair.publicKey, workchain: 0 });

  // Get the decentralized RPC endpoint in Testnet
  const endpoint = await getHttpEndpoint({
    network: "testnet",
  });

  // Initialize ton library
  const client = new TonClient({ endpoint });

  // Query balance from chain
  if (input.fields.functionDeclaration === "getBalance") {
    return {
      key: input.key,
      sessionId: input.sessionId,
      payload: {
        balance: await client.getBalance(Address.parse(input.fields.contractAddress)),
      },
    };
  }

  // Get transaction by it's id
  if (input.fields.functionDeclaration === "getTransaction") {
    return {
      key: input.key,
      sessionId: input.sessionId,
      payload: {
        transaction: await client.getTransaction(
          Address.parse(input.fields.contractAddress),
          input.fields.parameters.lt as string,
          input.fields.parameters.hash as string
        ),
      },
    };
  }

  // Fetch latest masterchain info
  if (input.fields.functionDeclaration === "getMasterchainInfo") {
    return {
      key: input.key,
      sessionId: input.sessionId,
      payload: {
        masterChainInfo: await client.getMasterchainInfo(),
      },
    };
  }

  // Check if contract is deployed
  if (input.fields.functionDeclaration === "isContractDeployed") {
    return {
      key: input.key,
      sessionId: input.sessionId,
      payload: {
        isDeployed: await client.isContractDeployed(Address.parse(input.fields.contractAddress)),
      },
    };
  }

  // Resolves contract state
  if (input.fields.functionDeclaration === "getContractState") {
    return {
      key: input.key,
      sessionId: input.sessionId,
      payload: {
        state: await client.getContractState(Address.parse(input.fields.contractAddress)),
      },
    };
  }

  // Make sure wallet is deployed
  if (!(await client.isContractDeployed(Address.parse(input.fields.contractAddress)))) {
    throw new Error(`${input.fields.contractAddress}: wallet is not deployed`);
  }

  // Send 0.05 TON to user_wallet to pay for gas fees
  const grindery_walletContract = client.open(grindery_wallet);
  const seqno = await grindery_walletContract.getSeqno();
  await grindery_walletContract.sendTransfer({
    secretKey: grindery_key.secretKey,
    seqno,
    messages: [
      internal({
        to: user_wallet.address,
        value: "0.05", // 0.05 TON
        bounce: false,
      }),
    ],
  });

  // Wait until confirmed
  let currentSeqno = seqno;
  while (currentSeqno === seqno) {
    console.log(`Gas transaction for ${user_wallet.address}: waiting for transaction to confirm...`);
    await sleep(1500);
    currentSeqno = await grindery_walletContract.getSeqno();
  }
  console.log(`Gas transaction for ${user_wallet.address}: transaction confirmed!`);

  // Initiate Counter contract
  const counterContract = client.open(new Counter(Address.parse(input.fields.contractAddress)));

  // Send the increment transaction
  await counterContract.sendIncrement(client.open(user_wallet).sender(user_keypair.secretKey));

  // Get user's last transaction hash using tonweb
  const lastTxHash = (await client.getTransactions(counterContract.address, { limit: 1 }))[0].hash;

  // Run a loop until user's last tx hash changes
  let txHash = lastTxHash;
  while (txHash === lastTxHash) {
    console.log("Waiting for counter transaction to confirm...");
    await sleep(1500); // some delay between API calls
    txHash = (await client.getTransactions(counterContract.address, { limit: 1 }))[0].hash;
  }
  console.log("Counter transaction confirmed!");

  return {
    key: input.key,
    sessionId: input.sessionId,
    payload: {
      transactionHash: txHash,
    },
  };
}

export async function getUserDroneAddress(_user: TAccessToken): Promise<string> {
  throw new Error("Not implemented");
}
