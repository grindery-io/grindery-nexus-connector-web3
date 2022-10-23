import { CHAIN_MAPPING } from "./chains";
import { Web3Wrapper } from "./wrapper";
import { ethers } from "ethers";

const web3Cache = new Map<string, Web3Wrapper>();
export function getWeb3(chain = "eth") {
  let [url, urlHttp] = Array.isArray(CHAIN_MAPPING[chain])
    ? (CHAIN_MAPPING[chain] as [string, string])
    : [(CHAIN_MAPPING[chain] as string) || "", ""];
  const isRawUrl = url.includes("://");
  if (!isRawUrl) {
    urlHttp = `https://rpc.ankr.com/${url || chain}/${process.env.ANKR_KEY}`;
    url = `wss://rpc.ankr.com/${url || chain}/ws/${process.env.ANKR_KEY}`;
  }
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
