import BN from "bn.js";
import Web3 from "web3";
import { getWeb3 } from "./web3/web3Utils";

const ERC20_DECIMALS_ABI = [
  {
    constant: true,
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
];

function numberToString(arg) {
  if (typeof arg === "string") {
    if (!arg.match(/^-?[0-9.]+$/)) {
      throw new Error(
        `while converting number to string, invalid number value '${arg}', should be a number matching (^-?[0-9.]+).`
      );
    }
    return arg;
  } else if (typeof arg === "number") {
    return String(arg);
  } else if (typeof arg === "object" && arg.toString && (arg.toTwos || arg.dividedToIntegerBy)) {
    if (arg.toPrecision) {
      return String(arg.toPrecision());
    } else {
      // eslint-disable-line
      return arg.toString(10);
    }
  }
  throw new Error(`while converting number to string, invalid number value '${arg}' type ${typeof arg}.`);
}

function scaleDecimals(etherInput: string, decimals: number) {
  let ether = numberToString(etherInput); // eslint-disable-line
  const base = new BN(10).pow(new BN(decimals));
  const baseLength = base.toString(10).length - 1;

  // Is it negative?
  const negative = ether.substring(0, 1) === "-"; // eslint-disable-line
  if (negative) {
    ether = ether.substring(1);
  }

  if (ether === ".") {
    throw new Error(`[ethjs-unit] while converting number ${etherInput} to wei, invalid value`);
  }

  // Split it into a whole and fractional part
  const comps = ether.split("."); // eslint-disable-line
  if (comps.length > 2) {
    throw new Error(`[ethjs-unit] while converting number ${etherInput} to wei,  too many decimal points`);
  }

  let whole = comps[0],
    fraction = comps[1]; // eslint-disable-line

  if (!whole) {
    whole = "0";
  }
  if (!fraction) {
    fraction = "0";
  }
  if (fraction.length > baseLength) {
    throw new Error(`[ethjs-unit] while converting number ${etherInput} to wei, too many decimal places`);
  }

  while (fraction.length < baseLength) {
    fraction += "0";
  }

  whole = new BN(whole);
  fraction = new BN(fraction);
  var wei = whole.mul(base).add(fraction); // eslint-disable-line

  if (negative) {
    wei = wei.mul(new BN(-1));
  }

  return wei.toString(10);
}
const UNIT_CONVERTERS: [
  RegExp,
  (
    value: unknown,
    m: RegExpMatchArray,
    fields: Record<string, unknown>,
    parameters: Record<string, unknown>
  ) => Promise<unknown>
][] = [
  [
    /erc20Decimals\[([^\]]+)\]/,
    async (
      value: unknown,
      m: RegExpMatchArray,
      fields: Record<string, unknown>,
      parameters: Record<string, unknown>
    ) => {
      let contractAddress = m[1];
      if (contractAddress === "@") {
        contractAddress = fields.contractAddress as string;
      } else if (parameters[contractAddress]) {
        contractAddress = parameters[contractAddress] as string;
      }
      if (!/^0x[0-9a-f]+$/i.test(contractAddress)) {
        throw new Error("erc20Decimals: Invalid contract address: " + contractAddress);
      }
      const { web3, close } = getWeb3(fields.chain as string);
      let decimals: number;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const contract = new web3.eth.Contract(ERC20_DECIMALS_ABI as any, contractAddress);
        decimals = await contract.methods.decimals().call({ from: contractAddress });
      } finally {
        close();
      }
      console.log(decimals);
      return scaleDecimals(String(value), decimals);
    },
  ],
  [
    /^([^-]+)->wei$/,
    async (value: unknown, m: RegExpMatchArray) => {
      console.log(String(value));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Web3.utils.toWei(String(value), m[1] as any);
    },
  ],
];

export async function convert(
  value: unknown,
  spec: string,
  fields: Record<string, unknown>,
  parameters: Record<string, unknown>
) {
  for (const [re, converter] of UNIT_CONVERTERS) {
    const m = re.exec(spec);
    if (m) {
      return await converter(value, m, fields, parameters);
    }
  }
  throw new Error("Invalid converter spec: " + spec);
}
