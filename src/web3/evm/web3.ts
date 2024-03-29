import { CHAIN_MAPPING } from "./chains";
import { Web3Wrapper } from "./wrapper";
import { ethers } from "ethers";

const web3Cache = new Map<string, Web3Wrapper>();
export function getWeb3(chain = "eip155:1") {
  if (!CHAIN_MAPPING[chain]) {
    throw new Error("Invalid chain: " + chain);
  }
  const [url, urlHttp] = CHAIN_MAPPING[chain];
  let wrapper = web3Cache.get(urlHttp);
  if (!wrapper || wrapper.isClosed()) {
    wrapper = new Web3Wrapper(url, urlHttp, chain);
    web3Cache.set(urlHttp, wrapper);
    wrapper.on("close", () => {
      if (web3Cache.get(urlHttp) === wrapper) {
        web3Cache.delete(urlHttp);
      }
    });
  } else {
    wrapper.addRef();
  }
  const ethersProvider = new ethers.providers.StaticJsonRpcProvider(urlHttp);
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
