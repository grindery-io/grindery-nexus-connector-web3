
import algosdk from "algosdk";

export async function getNetworkId(chain: string) : Promise<string> {
    return chain.split(':')[1];
}

export type DepayActions<T = unknown> = {
    fields: T;
};

export type NearDepayActions = {
    grinderyAccount: any;
    userAccount: any;
};

export type AlgorandDepayActions = {
    comp: algosdk.AtomicTransactionComposer;
    algodClient: algosdk.Algodv2;
    grinderyAccount: algosdk.Account;
    receiver: string;
    spNoFee: algosdk.SuggestedParams;
    commonParamsFullFee: any;
};