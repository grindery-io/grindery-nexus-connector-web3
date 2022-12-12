import axios from "axios";
import {
  ConnectorInput,
  ConnectorOutput,
} from "grindery-nexus-common-utils/dist/connector";
import { DepayActions, AlgorandDepayActions } from "../utils";
import { setSpFee, feedAccount, getbalance } from "./utils";
import algosdk from "algosdk";
import nftMetadata from "./contracts/nft/metadata.json";
import _ from "lodash";
import crypto from "crypto";

// see ASA param conventions here: https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0003.md
// for JavaScript SDK doc see: https://algorand.github.io/js-algorand-sdk/

export async function SendTransactionAction(
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
  }>,
  depay: DepayActions<AlgorandDepayActions>
): Promise<ConnectorOutput> {
  // Feed the user account
  await feedAccount(
    depay.fields.grinderyAccount,
    depay.fields.userAccount,
    200000,
    depay.fields.algodClient
  );

  console.log("");
  console.log("==> CREATE ASSET");
  console.log(
    "User account balance: %d microAlgos",
    await getbalance(depay.fields.userAccount, depay.fields.algodClient)
  );

  // Whether user accounts will need to be unfrozen before transacting
  const defaultFrozen = false;
  // Used to display asset units to user
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unitName: any = input.fields.parameters.unitName;
  // Friendly name of the asset
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assetName: any = input.fields.parameters.assetName;
  // Optional hash commitment of some sort relating to the asset. 32 character length.
  // metadata can define the unitName and assetName as well.
  // see ASA metadata conventions here: https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0003.md

  // The following parameters are the only ones
  // that can be changed, and they have to be changed
  // by the current manager
  // Specified address can change reserve, freeze, clawback, and manager
  // If they are set to undefined at creation time, you will not be able to modify these later
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const managerAddr: any = input.fields.parameters.to; // OPTIONAL: FOR DEMO ONLY, USED TO DESTROY ASSET WITHIN
  // Specified address is considered the asset reserve
  // (it has no special privileges, this is only informational)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reserveAddr: any = input.fields.parameters.to;
  // Specified address can freeze or unfreeze user asset holdings
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const freezeAddr: any = input.fields.parameters.to;
  // Specified address can revoke user asset holdings and send
  // them to other addresses
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clawbackAddr: any = input.fields.parameters.to;

  // Use actual total  > 1 to create a Fungible Token
  // example 1:(fungible Tokens)
  // totalIssuance = 10, decimals = 0, result is 10 total actual
  // example 2: (fractional NFT, each is 0.1)
  // totalIssuance = 10, decimals = 1, result is 1.0 total actual
  // example 3: (NFT)
  // totalIssuance = 1, decimals = 0, result is 1 total actual
  // integer number of decimals for asset unit calculation
  const decimals = 0;
  const total = 1; // how many of this asset there will be

  const metadataraw = _.cloneDeep(nftMetadata);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const image_url: any = input.fields.parameters.image_url;
  metadataraw.name = unitName;
  metadataraw.description = assetName;
  metadataraw.image = image_url;
  metadataraw.properties.simple_property = assetName;
  metadataraw.properties.rich_property.name = unitName;

  const response = await axios.get(image_url, { responseType: "arraybuffer" });
  const metadatafileImage = Buffer.from(response.data, "utf-8");
  const hashImage = crypto.createHash("sha256");
  hashImage.update(metadatafileImage);
  const hashImageBase64 = hashImage.digest("base64");
  metadataraw.image_integrity = "sha256-" + hashImageBase64;

  //     const fullPathImage = __dirname + '/contracts/nft/nft_img.png';
  // //    const metadatafileImage = (await fs.readFileSync(fullPathImage));
  //     const metadatafileImage = (await fs.readFile(fullPathImage));
  //     const hashImage = crypto.createHash('sha256');
  //     hashImage.update(metadatafileImage);
  //     const hashImageBase64 = hashImage.digest("base64");
  //     const imageIntegrity = "sha256-" + hashImageBase64;
  // // use this in yout metadata.json file
  // console.log("image_integrity : " + imageIntegrity);

  const hash = crypto.createHash("sha256");
  hash.update(Buffer.from(JSON.stringify(metadataraw)));

  const metadata = new Uint8Array(hash.digest()); // use this in your code
  const spNoFee = await setSpFee(0, depay.fields.algodClient);
  const spFullFee = await setSpFee(
    2 * algosdk.ALGORAND_MIN_TX_FEE,
    depay.fields.algodClient
  );

  // signing and sending "txn" allows "addr" to create an asset
  const txn = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
    from: depay.fields.userAccount.addr,
    total,
    decimals,
    assetName,
    unitName,
    assetURL: undefined,
    assetMetadataHash: metadata,
    defaultFrozen,
    freeze: freezeAddr,
    manager: managerAddr,
    clawback: clawbackAddr,
    reserve: reserveAddr,
    suggestedParams: spNoFee,
  });

  depay.fields.comp.addTransaction({
    txn,
    signer: algosdk.makeBasicAccountTransactionSigner(depay.fields.userAccount),
  });

  const txnToPayGas = algosdk.makePaymentTxnWithSuggestedParams(
    depay.fields.grinderyAccount.addr,
    depay.fields.receiver,
    0,
    undefined,
    undefined,
    spFullFee
  );

  depay.fields.comp.addTransaction({
    txn: txnToPayGas,
    signer: algosdk.makeBasicAccountTransactionSigner(
      depay.fields.grinderyAccount
    ),
  });

  const result = await depay.fields.comp.execute(depay.fields.algodClient, 2);

  console.log("result = " + JSON.stringify(result));
  console.log("payload = " + result.txIDs[0]);

  return {
    key: input.key,
    sessionId: input.sessionId,
    payload: { TxHash: result.txIDs[0] },
  };
}
