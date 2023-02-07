import { v4 as uuidv4 } from "uuid";

import { createAccount } from ".";
import { FlowAddressToken } from "../../jwt";

const inFlight = new Map<string, Promise<{ address: string }> | null>();

export function createAccountBegin() {
  const token = uuidv4();
  const promise = createAccount();
  inFlight.set(token, null);
  promise
    .catch((e) => {
      console.error("Error when creating Flow account:", e);
    })
    .finally(() => {
      inFlight.set(token, promise);
      setTimeout(() => inFlight.delete(token), 15000);
    });
  return { token };
}

export async function createAccountQuery(token: string) {
  if (!inFlight.has(token)) {
    throw new Error("Invalid token");
  }
  const promise = inFlight.get(token);
  if (!promise) {
    return { status: "pending" };
  }
  const result = await promise;
  return { code: await FlowAddressToken.encrypt({ sub: result.address }, "30s") };
}

export async function createAccountComplete(code: string) {
  const decrypted = await FlowAddressToken.decrypt(code).catch(() => null);
  if (!decrypted) {
    throw new Error("Invalid code");
  }
  return { address: decrypted.sub };
}

export default { createAccountBegin, createAccountQuery, createAccountComplete };
