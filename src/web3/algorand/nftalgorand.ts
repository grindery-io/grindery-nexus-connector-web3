import axios, { AxiosResponse } from "axios";
import {
    ConnectorInput,
    ConnectorOutput,
} from "grindery-nexus-common-utils/dist/connector";
import {DepayActions, AlgorandDepayActions} from "../utils";
import { getUserAccountAlgorand, 
    parseFunctionDeclarationAlgorand,
    getAlgodClient,
    setSpFee 
  } from "./utils"; 
import {v4 as uuidv4} from 'uuid';
import algosdk, { decodeAddress, Transaction } from "algosdk";
require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs').promises
// see ASA param conventions here: https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0003.md
// for JavaScript SDK doc see: https://algorand.github.io/js-algorand-sdk/


const DISPENSERACCOUNT = "HZ57J3K46JIJXILONBBZOHX6BKPXEM2VVXNRFSUED6DKFD5ZD24PMJ3MVA";

async function createAsset(algodClient, alice) {
    console.log("");
    console.log("==> CREATE ASSET");
    //Check account balance    
    const accountInfo = await algodClient.accountInformation(alice.addr).do();
    const startingAmount = accountInfo.amount;
    console.log("Alice account balance: %d microAlgos", startingAmount);

    // Construct the transaction
    const params = await algodClient.getTransactionParams().do();
    // comment out the next two lines to use suggested fee
    // params.fee = 1000;
    // params.flatFee = true;
    // const closeout = receiver; //closeRemainderTo
    // WARNING! all remaining funds in the sender account above will be sent to the closeRemainderTo Account 
    // In order to keep all remaining funds in the sender account after tx, set closeout parameter to undefined.
    // For more info see: 
    // https://developer.algorand.org/docs/reference/transactions/#payment-transaction
    // Asset creation specific parameters
    // The following parameters are asset specific
    // Throughout the example these will be re-used. 

    // Whether user accounts will need to be unfrozen before transacting    
    const defaultFrozen = false;
    // Used to display asset units to user    
    const unitName = "ALICEART";
    // Friendly name of the asset    
    const assetName = "Alice's Artwork@arc3";
    // Optional string pointing to a URL relating to the asset
    const url = "https://s3.amazonaws.com/your-bucket/metadata.json";
    // Optional hash commitment of some sort relating to the asset. 32 character length.
    // metadata can define the unitName and assetName as well.
    // see ASA metadata conventions here: https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0003.md


    // The following parameters are the only ones
    // that can be changed, and they have to be changed
    // by the current manager
    // Specified address can change reserve, freeze, clawback, and manager
    // If they are set to undefined at creation time, you will not be able to modify these later
    const managerAddr = alice.addr; // OPTIONAL: FOR DEMO ONLY, USED TO DESTROY ASSET WITHIN
    // Specified address is considered the asset reserve
    // (it has no special privileges, this is only informational)
    const reserveAddr = undefined;
    // Specified address can freeze or unfreeze user asset holdings   
    const freezeAddr = undefined;
    // Specified address can revoke user asset holdings and send 
    // them to other addresses    
    const clawbackAddr = undefined;

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

    // temp fix for replit    
    //const metadata2 = "16efaa3924a6fd9d3a4824799a4ac65d";

    // const fullPath = __dirname + '/NFT/metadata.json';

//     const fullPath = __dirname + '/contracts/nft/metadata.json';
//     const metadatafile = (await fs.readFile(fullPath));
// //    const metadatafile = (await fs.readFileSync(fullPath)).toString();
//     const hash = crypto.createHash('sha256');
//     hash.update(metadatafile);


    const fullPath = __dirname + '/contracts/nft/metadata.json';
    let metadataraw = JSON.parse(await fs.readFile(fullPath, "utf8"));
    let image_url = "https://c0.lestechnophiles.com/www.numerama.com/wp-content/uploads/2021/12/nft-singes-1024x576.jpg?webp=1&key=681596ec";
    metadataraw.name = unitName;
    metadataraw.description = assetName;
    metadataraw.image = image_url;
    metadataraw.properties.simple_property = assetName;
    metadataraw.properties.rich_property.name = unitName;


    const response = await axios.get(image_url,  { responseType: 'arraybuffer' });
    const metadatafileImage = Buffer.from(response.data, "utf-8");
    const hashImage = crypto.createHash('sha256');
    hashImage.update(metadatafileImage);
    const hashImageBase64 = hashImage.digest("base64");
    metadataraw.image_integrity = "sha256-" + hashImageBase64;

    const hash = crypto.createHash('sha256');
    hash.update(Buffer.from(JSON.stringify(metadataraw)));




    // replit error  - work around
    // const metadata = "16efaa3924a6fd9d3a4824799a4ac65d";
    // replit error  - the following only runs in debug mode in replit, and use this in your code
    const metadata = new Uint8Array(hash.digest()); // use this in your code



//     const fullPathImage = __dirname + '/NFT/alice-nft.png';
// //    const metadatafileImage = (await fs.readFileSync(fullPathImage));
//     const metadatafileImage = (await fs.readFile(fullPathImage));
//     const hashImage = crypto.createHash('sha256');
//     hashImage.update(metadatafileImage);
//     const hashImageBase64 = hashImage.digest("base64");
//     const imageIntegrity = "sha256-" + hashImageBase64;

//     // use this in yout metadata.json file
//     console.log("image_integrity : " + imageIntegrity);

    // signing and sending "txn" allows "addr" to create an asset 
    const txn = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
        from: alice.addr,
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
        suggestedParams: params,
    });


    const rawSignedTxn = txn.signTxn(alice.sk);
    const tx = (await algodClient.sendRawTransaction(rawSignedTxn).do());
    let assetID = null;
    // wait for transaction to be confirmed
    const confirmedTxn = await algosdk.waitForConfirmation(algodClient, tx.txId, 4);
    //Get the completed Transaction
    console.log("Transaction " + tx.txId + " confirmed in round " + confirmedTxn["confirmed-round"]);
    assetID = confirmedTxn["asset-index"];
    // console.log("AssetID = " + assetID);

    await printCreatedAsset(algodClient, alice.addr, assetID);
    await printAssetHolding(algodClient, alice.addr, assetID);
    console.log("You can verify the metadata-hash above in the asset creation details");
    console.log("Using terminal the Metadata hash should appear as identical to the output of");
    console.log("cat aliceAssetMetaData.json | openssl dgst -sha256 -binary | openssl base64 -A");
    console.log("That is: Cii04FOHWE4NiXQ4s4J02we2gnJop5dOfdkBvUoGHQ8=");

    return { assetID };











    // Sample Output similar to
    // ==> CREATE ASSET
    // Alice account balance: 10000000 microAlgos
    // Transaction DM2QAJQ34AHOIH2XPOXB3KDDMFYBTSDM6CGO6SCM6A6VJYF5AUZQ confirmed in round 16833515
    // AssetID = 28291127
    // parms = {
    //   "clawback": "RA6RAUNDQGHRWTCR5YRL2YJMIXTHWD5S3ZYHVBGSNA76AVBAYELSNRVKEI",
    //   "creator": "RA6RAUNDQGHRWTCR5YRL2YJMIXTHWD5S3ZYHVBGSNA76AVBAYELSNRVKEI",
    //   "decimals": 0,
    //   "default-frozen": false,
    //   "freeze": "RA6RAUNDQGHRWTCR5YRL2YJMIXTHWD5S3ZYHVBGSNA76AVBAYELSNRVKEI",
    //   "manager": "RA6RAUNDQGHRWTCR5YRL2YJMIXTHWD5S3ZYHVBGSNA76AVBAYELSNRVKEI",
    //   "metadata-hash": "WQ4GxK4WqdklhWD9zJMfYH+Wgk+rTnqJIdW08Y7eD1U=",
    //   "name": "Alice's Artwork Coins",
    //   "name-b64": "QWxpY2UncyBBcnR3b3JrIENvaW5z",
    //   "reserve": "RA6RAUNDQGHRWTCR5YRL2YJMIXTHWD5S3ZYHVBGSNA76AVBAYELSNRVKEI",
    //   "total": 999,
    //   "unit-name": "ALICECOI",
    //   "unit-name-b64": "QUxJQ0VDT0k=",
    //   "url": "http://someurl",
    //   "url-b64": "aHR0cDovL3NvbWV1cmw="
    // }
    // assetholdinginfo = {
    //   "amount": 999,
    //   "asset-id": 28291127,
    //   "creator": "RA6RAUNDQGHRWTCR5YRL2YJMIXTHWD5S3ZYHVBGSNA76AVBAYELSNRVKEI",
    //   "is-frozen": false
    // }
}

// Function used to print created asset for account and assetid
const printCreatedAsset = async function (algodClient, account, assetid) {
    // note: if you have an indexer instance available it is easier to just use this
    //     let accountInfo = await indexerClient.searchAccounts()
    //    .assetID(assetIndex).do();
    // and in the loop below use this to extract the asset for a particular account
    // accountInfo['accounts'][idx][account]);
    let accountInfo = await algodClient.accountInformation(account).do();
    for (let idx = 0; idx < accountInfo['created-assets'].length; idx++) {
        let scrutinizedAsset = accountInfo['created-assets'][idx];
        if (scrutinizedAsset['index'] == assetid) {
            console.log("AssetID = " + scrutinizedAsset['index']);
            let myparms = JSON.stringify(scrutinizedAsset['params'], undefined, 2);
            console.log("parms = " + myparms);
            break;
        }
    }
};
// Function used to print asset holding for account and assetid
const printAssetHolding = async function (algodClient, account, assetid) {
    // note: if you have an indexer instance available it is easier to just use this
    //     let accountInfo = await indexerClient.searchAccounts()
    //    .assetID(assetIndex).do();
    // and in the loop below use this to extract the asset for a particular account
    // accountInfo['accounts'][idx][account]);
    let accountInfo = await algodClient.accountInformation(account).do();
    for (let idx = 0; idx < accountInfo['assets'].length; idx++) {
        let scrutinizedAsset = accountInfo['assets'][idx];
        if (scrutinizedAsset['asset-id'] == assetid) {
            let myassetholding = JSON.stringify(scrutinizedAsset, undefined, 2);
            console.log("assetholdinginfo = " + myassetholding);
            break;
        }
    }
};


async function createNFT() {

    try {
        // let alice = createAccount();

        const grinderyAccount = algosdk.mnemonicToSecretKey(process.env.ALGORAND_MNEMONIC_GRINDERY!);
        let algodClient = await getAlgodClient("algorand:testnet")

        await createAsset(algodClient, grinderyAccount);

        // // CREATE ASSET
        // const { assetID } = await createAsset(algodClient, grinderyAccount);
        // // DESTROY ASSET
        // await destroyAsset(algodClient, grinderyAccount, assetID);
        // // CLOSEOUT ALGOS - Alice closes out Alogs to dispenser
        // await closeoutAliceAlgos(algodClient, grinderyAccount);


    } catch (err) {

        console.log("err", err);
        
    }
    process.exit();
};






// createNFT();


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


    depay.fields.userAccount = algosdk.mnemonicToSecretKey(process.env.ALGORAND_MNEMONIC!);

    console.log("");
    console.log("==> CREATE ASSET");
    //Check account balance    
    const accountInfo = await depay.fields.algodClient.accountInformation(depay.fields.userAccount.addr).do();
    const startingAmount = accountInfo.amount;
    console.log("Alice account balance: %d microAlgos", startingAmount);

    // Construct the transaction
    const params = await depay.fields.algodClient.getTransactionParams().do();

    // Whether user accounts will need to be unfrozen before transacting    
    const defaultFrozen = false;
    // Used to display asset units to user    
    const unitName:any = input.fields.parameters.unitName;
    // Friendly name of the asset    
    const assetName:any = input.fields.parameters.assetName;
    // Optional string pointing to a URL relating to the asset
    const url = undefined;
    // Optional hash commitment of some sort relating to the asset. 32 character length.
    // metadata can define the unitName and assetName as well.
    // see ASA metadata conventions here: https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0003.md


    // The following parameters are the only ones
    // that can be changed, and they have to be changed
    // by the current manager
    // Specified address can change reserve, freeze, clawback, and manager
    // If they are set to undefined at creation time, you will not be able to modify these later
    const managerAddr:any = input.fields.parameters.to; // OPTIONAL: FOR DEMO ONLY, USED TO DESTROY ASSET WITHIN
    // Specified address is considered the asset reserve
    // (it has no special privileges, this is only informational)
    const reserveAddr:any = input.fields.parameters.to;
    // Specified address can freeze or unfreeze user asset holdings   
    const freezeAddr:any = input.fields.parameters.to;
    // Specified address can revoke user asset holdings and send 
    // them to other addresses    
    const clawbackAddr:any = input.fields.parameters.to;

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

    // temp fix for replit    
    //const metadata2 = "16efaa3924a6fd9d3a4824799a4ac65d";

    // const fullPath = __dirname + '/NFT/metadata.json';

//     const fullPath = __dirname + '/contracts/nft/metadata.json';
//     const metadatafile = (await fs.readFile(fullPath));
// //    const metadatafile = (await fs.readFileSync(fullPath)).toString();
//     const hash = crypto.createHash('sha256');
//     hash.update(metadatafile);


    const fullPath = __dirname + '/contracts/nft/metadata.json';
    let metadataraw = JSON.parse(await fs.readFile(fullPath, "utf8"));
    let image_url: any = input.fields.parameters.image_url;
    metadataraw.name = unitName;
    metadataraw.description = assetName;
    metadataraw.image = image_url;
    metadataraw.properties.simple_property = assetName;
    metadataraw.properties.rich_property.name = unitName;


    const response = await axios.get(image_url,  { responseType: 'arraybuffer' });
    const metadatafileImage = Buffer.from(response.data, "utf-8");
    const hashImage = crypto.createHash('sha256');
    hashImage.update(metadatafileImage);
    const hashImageBase64 = hashImage.digest("base64");
    metadataraw.image_integrity = "sha256-" + hashImageBase64;

    const hash = crypto.createHash('sha256');
    hash.update(Buffer.from(JSON.stringify(metadataraw)));




    // replit error  - work around
    // const metadata = "16efaa3924a6fd9d3a4824799a4ac65d";
    // replit error  - the following only runs in debug mode in replit, and use this in your code
    const metadata = new Uint8Array(hash.digest()); // use this in your code



//     const fullPathImage = __dirname + '/NFT/alice-nft.png';
// //    const metadatafileImage = (await fs.readFileSync(fullPathImage));
//     const metadatafileImage = (await fs.readFile(fullPathImage));
//     const hashImage = crypto.createHash('sha256');
//     hashImage.update(metadatafileImage);
//     const hashImageBase64 = hashImage.digest("base64");
//     const imageIntegrity = "sha256-" + hashImageBase64;

//     // use this in yout metadata.json file
//     console.log("image_integrity : " + imageIntegrity);


    const spNoFee = await setSpFee(0, depay.fields.algodClient);
    const spFullFee = await setSpFee(2 * algosdk.ALGORAND_MIN_TX_FEE, depay.fields.algodClient);

    const commonParamsNoFee = {
        sender: depay.fields.userAccount.addr,
        suggestedParams: spNoFee,
        signer: algosdk.makeBasicAccountTransactionSigner(depay.fields.userAccount),
    };

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


    // const rawSignedTxn = txn.signTxn(depay.fields.userAccount.sk);
    // const tx = (await depay.fields.algodClient.sendRawTransaction(rawSignedTxn).do());
    // let assetID = null;
    // // wait for transaction to be confirmed
    // const confirmedTxn = await algosdk.waitForConfirmation(depay.fields.algodClient, tx.txId, 4);
    // //Get the completed Transaction
    // console.log("Transaction " + tx.txId + " confirmed in round " + confirmedTxn["confirmed-round"]);
    // assetID = confirmedTxn["asset-index"];
    // // console.log("AssetID = " + assetID);

    depay.fields.comp.addTransaction({
        txn: txn,
        signer: algosdk.makeBasicAccountTransactionSigner(depay.fields.userAccount)
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
        signer: algosdk.makeBasicAccountTransactionSigner(depay.fields.grinderyAccount)
    });

    let result: any = await depay.fields.comp.execute(depay.fields.algodClient, 2);

    console.log("result = " + JSON.stringify(result));


    // await printCreatedAsset(depay.fields.algodClient, depay.fields.userAccount.addr, assetID);
    // await printAssetHolding(depay.fields.algodClient, depay.fields.userAccount.addr, assetID);
    // console.log("You can verify the metadata-hash above in the asset creation details");
    // console.log("Using terminal the Metadata hash should appear as identical to the output of");
    // console.log("cat aliceAssetMetaData.json | openssl dgst -sha256 -binary | openssl base64 -A");
    // console.log("That is: Cii04FOHWE4NiXQ4s4J02we2gnJop5dOfdkBvUoGHQ8=");

    throw new Error("Not implemented");


  }

