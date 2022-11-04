import { config, mutate, tx, send } from "@onflow/fcl";
import { template as createAccountTemplate } from "@onflow/six-create-account";
import { createSigner, publicKeyFromPrivateKey } from "./signer";

// Contrary to our wallet signing example, we don't need most of it in our config now
// so we'll get back to simple version
config({
  "accessNode.api": "https://rest-mainnet.onflow.org",
  "fcl.limit": 1000000,
});

export async function sendTransaction({
  cadence,
  args,
  signerArgs,
}: {
  cadence: string;
  args: [unknown, string][];
  signerArgs: Parameters<typeof createSigner>[0];
}) {
  const signer = createSigner(signerArgs);
  const proposer = signer;
  const payer = signer;
  const authorizations = [signer];

  // "mutate" method will return us transaction id
  const txId = await mutate({
    cadence,
    args: (arg, t) => args.map(([value, type]) => arg(value, t[type])),
    proposer,
    payer,
    authorizations,
    limit: 50,
  });

  const txDetails = await tx(txId).onceSealed();
  return txDetails;
}

export async function createAccount({
  signerArgs,
}: {
  signerArgs: Parameters<typeof createSigner>[0];
}): Promise<unknown> {
  const signer = createSigner(signerArgs);
  const proposer = signer;
  const payer = signer;
  const authorization = signer;
  const response = await send([
    createAccountTemplate({
      proposer,
      authorization,
      payer,
      publicKey: publicKeyFromPrivateKey(signerArgs.pkey),
      signatureAlgorithm: "2",
      hashAlgorithm: "1",
      weight: "1000.0",
    }),
  ]);
  const txDetails = await tx(response.transactionId).onceSealed();
  const accountEvent = await txDetails.events.find((x) => x.type === "flow.AccountCreated");
  return { address: accountEvent.data.address };
}
