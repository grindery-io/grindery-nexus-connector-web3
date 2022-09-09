import { LoggerAdaptToConsole, LOG_LEVEL } from "console-log-json";
import { runConnector } from "grindery-nexus-common-utils/dist/connector";
import { CONNECTOR_DEFINITION } from "./connector";

if (process.env.LOG_JSON) {
  LoggerAdaptToConsole({ logLevel: LOG_LEVEL.debug });
}
runConnector(CONNECTOR_DEFINITION);
