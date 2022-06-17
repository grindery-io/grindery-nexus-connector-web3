import "core-js";
import "dotenv/config";
import * as Sentry from "@sentry/node";
import util from "util";

Sentry.init();

import { main } from "./app";

const env = process.env;

async function handleHttp(req, res) {
  if ("CORS_ENABLED" in env && env.CORS_ENABLED) {
    res.set({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    });
  }
  if (req.method === "OPTIONS") {
    return res.status(206).end();
  }
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }
  const rawBody = req.body;

  if (Buffer.isBuffer(req.body)) {
    try {
      req.body = req.body.toString("utf-8");
    } catch (e) {
      return res.status(415).send("Unsupported Media Type (Not UTF-8)");
    }
  }
  if (typeof req.body === "string") {
    try {
      req.body = JSON.parse(req.body);
    } catch (e) {
      return res.status(415).send("Unsupported Media Type");
    }
  }
  if (!req.body) {
    return res.status(400).send("Bad request");
  }
  req.query = req.query || {};
  if (
    "INVOKE_KEY" in env &&
    (req.body.key || req.query.key) !== env.INVOKE_KEY &&
    !req.originalUrl.endsWith("/" + env.INVOKE_KEY)
  ) {
    return res.status(403).send("Forbidden");
  }
  if ("INVOKE_KEY" in env) {
    delete req.body.key;
  }
  const result = await main(req.body, { eventType: "http", req, rawBody });
  if (result && result.sendResponse) {
    return result.sendResponse(res);
  }
  res.status(200).json(result);
}

function createHttpHandler() {
  const handleRequest = Sentry.Handlers.requestHandler({ flushTimeout: 3000 });
  const handleError = Sentry.Handlers.errorHandler({ shouldHandleError: () => true });
  return (req, res) =>
    handleRequest(req, res, () => {
      handleHttp(req, res).catch((e) => {
        if (e.response) {
          console.error(
            JSON.stringify({
              statusCode: e.statusCode || e.response.status || e.response.statusCode || e.code,
              method: e.response.request?.method || e.request?.method,
              url: e.response.request?.uri?.href || e.request?.uri?.href,
              body: e.response.body || e.response.data,
            })
          );
          e = e.response.body || e.response.data || e;
        } else {
          console.error(e);
        }
        if (!(e instanceof Error)) {
          const err = new Error(e.message || util.inspect(e, { depth: 1 }));
          Sentry.configureScope((scope) => {
            scope.setContext(
              "rawErrorText",
              Object.fromEntries(Object.keys(e).map((key) => [key, util.inspect(e[key], { depth: 10 })]))
            );
            try {
              JSON.stringify(e);
              scope.setContext("rawError", e);
            } catch (_) {
              // Ignore
            }
            e = err;
          });
        }
        handleError(e, req, res, () => {
          Sentry.flush(2000).then(() => {
            if (!res.headersSent) {
              res.status(500).send("Internal server error");
            }
          });
        });
      });
    });
}

async function cliMain() {
  return await main({ jsonrpc: "2.0", method: process.argv[2], params: JSON.parse(process.argv[3] || "[]"), id: 1 });
}

// Google Cloud Functions support
const FUNCTION_NAME = process.env.FUNCTION_TARGET || process.env.FUNCTION_NAME || process.env.npm_package_name;

exports["http"] = createHttpHandler();
exports[FUNCTION_NAME] = exports["http"];
exports["main"] = cliMain;

// vim: sw=2:ts=2:expandtab:fdm=syntax
