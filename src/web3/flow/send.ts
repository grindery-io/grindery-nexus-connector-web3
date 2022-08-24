import { config, mutate, tx } from "@onflow/fcl";
import { createSigner } from "./signer";

// Contrary to our wallet signing example, we don't need most of it in our config now
// so we'll get back to simple version
config({
  "accessNode.api": "https://rest-mainnet.onflow.org",
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
