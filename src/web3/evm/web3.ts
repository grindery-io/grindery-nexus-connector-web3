import { CHAIN_MAPPING } from "./chains";
import { Web3Wrapper } from "./wrapper";
import { ethers } from "ethers";

const web3Cache = new Map<string, Web3Wrapper>();
export function getWeb3(chain = "eip155:1") {
  if (!CHAIN_MAPPING[chain]) {
    throw new Error("Invalid chain: " + chain);
  }
  const [url, urlHttp] = CHAIN_MAPPING[chain];
  let wrapper = web3Cache.get(url);
  if (!wrapper || wrapper.isClosed()) {
    wrapper = new Web3Wrapper(url, urlHttp);
    web3Cache.set(url, wrapper);
    wrapper.on("close", () => {
      if (web3Cache.get(url) === wrapper) {
        web3Cache.delete(url);
      }
    });
  } else {
    wrapper.addRef();
  }
  const ethersProvider = new ethers.providers.JsonRpcProvider(urlHttp || url);
  return {
    web3: wrapper.web3,
    ethersProvider,
    close: () => {
      wrapper?.close();
      wrapper = undefined;
    },
    onNewBlock: wrapper?.onNewBlock.bind(wrapper),
    web3Wrapper: wrapper,
  };
}
