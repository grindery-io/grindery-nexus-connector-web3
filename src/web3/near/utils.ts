import _ from "lodash";
import { getNetworkId } from "../utils";

const { connect, keyStores } = require("near-api-js");
const path = require("path");
const homedir = require("os").homedir();

// const private_key_tcoratger = "ed25519:TvQJsaDCF65uVGfeAzHkSSUFcpbM127uJ3A7GJLnh1eZuRD2wqjdkYWRJXfbkxa6v5yzPjSiPYQ7nQsdgtebEzE";
// const public_key_tcoratger_wallet = "0xB201fDd90b14cc930bEc2c4E9f432bC1CA5Ad7X7";

// const private_key_depay = 
// "ed25519:4STJ43D4LEL7bbSrp3hP1JiuFLZ8gmjuVa5zafQxGpMJXNknFZ1UzYmUuPiuYPKUxDPNbfrw92JuLHDRQEvu2kLb"

// const userToken = "eyJhbGciJiJFUzI1NiJ8.eyJhdWQiOiJ1cm46Z3JpbmRlcnk6YWNjZXNzLXRva2VuOnYxIiwic3ViIjoiZWlwMTU1OjE6MHhCMjAxZkRkOTBiMTRjYzkzMGJFYzJjNEU5ZjQzMmJDMUNBNUFkN0M1IiwiaWF0IjoxNjY3Njk0NDk5LCJpc3MiOiJ1cm46Z3JpbmRlcnk6b3JjaGVzdHJhdG9yIiwiZXhwIjoxNjY3Njk4MDk5fQ.eSuX4Jx4VutnAFvs9kC48G4ccHlAuv8OoDzfKZhcFyFQCMda2LxZV4BbZGstFsT-WMoVpKEIexj8O-hg1jm2ZZ"

// const networkId = "testnet";
// // const accountId = "depay.tcoratger.testnet";
// const accountId = "tcoratger.testnet";

// const nodeUrl= "https://rpc.testnet.near.org";
// const explorerUrl= "https://explorer.testnet.near.org";
// const walletUrl= "https://wallet.testnet.near.org";
// const CREDENTIALS_DIR = ".near-credentials";

// const credentialsPath = path.join(userHomeDir, CREDENTIALS_DIR);
// const keyStore = new keyStores.UnencryptedFileSystemKeyStore(credentialsPath);

// const config = {
//     keyStore,
//     networkId: "testnet",
//     nodeUrl: "https://rpc.testnet.near.org",
// };

async function main() {

    const chain = "near:testnet";
    const key = "callSmartContract:NFTMint";

    const result = chain.concat(':' + key.split(':')[1]);

    console.log(result);
}

// main()




export async function nearGetAccount(chain: string, accountId: string | undefined) {
    const networkId = await getNetworkId(chain);
    const keyStore = await getKeyStore();
    const config = {
        networkId,
        keyStore,
        nodeUrl: `https://rpc.${networkId}.near.org`,
        walletUrl: `https://wallet.${networkId}.near.org`,
        helperUrl: `https://helper.${networkId}.near.org`,
        explorerUrl: `https://explorer.${networkId}.near.org`,
    };
    const near = await connect({ ...config, keyStore });
    return await near.account(accountId);
}

export async function getKeyStore() {
    const CREDENTIALS_DIR = ".near-credentials";
    const credentialsPath = path.join(homedir, CREDENTIALS_DIR);
    return (new keyStores.UnencryptedFileSystemKeyStore(credentialsPath));
}
