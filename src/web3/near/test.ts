// import * as nearAPI from "near-api-js";

const nearAPI = require("near-api-js");

const { connect, keyStores, WalletConnection } = nearAPI;

const homedir = require("os").homedir();
const CREDENTIALS_DIR = ".near-credentials";
const credentialsPath = require("path").join(homedir, CREDENTIALS_DIR);
const myKeyStore = new keyStores.UnencryptedFileSystemKeyStore(credentialsPath);



async function App() {

    

    const connectionConfig = {
        networkId: "testnet",
        keyStore: myKeyStore,
        nodeUrl: "https://rpc.testnet.near.org",
        walletUrl: "https://wallet.testnet.near.org",
        helperUrl: "https://helper.testnet.near.org",
        explorerUrl: "https://explorer.testnet.near.org",
        headers: {}
    };

    // connect to NEAR
    const nearConnection = await connect(connectionConfig);

    console.log("succeeded");

    // // create wallet connection
    // const walletConnection = new WalletConnection(nearConnection, null);
}

App();