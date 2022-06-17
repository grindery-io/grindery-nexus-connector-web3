import { createJSONRPCErrorResponse, JSONRPCErrorCode, JSONRPCParams, JSONRPCServer } from "json-rpc-2.0";
import { runAction, setupSignal } from "./connector";
import { test } from "./web3";
import * as Sentry from "@sentry/node";
import WebSocket from "ws";

export class InvalidParamsError extends Error {
  constructor(message?: string) {
    super(message || "Invalid parameters");
  }
}
const exceptionMiddleware = async (next, request, serverParams) => {
  try {
    return await next(request, serverParams);
  } catch (error) {
    if (error instanceof InvalidParamsError) {
      return createJSONRPCErrorResponse(request.id, JSONRPCErrorCode.InvalidParams, error.message);
    } else if (error.isAxiosError) {
      return createJSONRPCErrorResponse(request.id, error.response?.status, error.message, {
        headers: error.response?.headers,
        data: error.response?.data,
      });
    } else {
      Sentry.captureException(error);
      await Sentry.flush(2000);
      throw error;
    }
  }
};
function byObject<T extends { [key: string]: unknown }>(func: (params: T, extra: { socket: WebSocket }) => unknown) {
  return async function (params: Partial<JSONRPCParams> | undefined, extra) {
    if (typeof params !== "object" || Array.isArray(params)) {
      throw new InvalidParamsError("Only parameter object are supported");
    }
    return func(params as T, extra);
  };
}
export function createJsonRpcServer() {
  const server = new JSONRPCServer();
  server.applyMiddleware(exceptionMiddleware);
  server.addMethod("ping", () => "pong");
  server.addMethod("setupSignal", byObject(setupSignal));
  server.addMethod("runAction", byObject(runAction));
  server.addMethod("test", byObject(test));
  return server;
}
