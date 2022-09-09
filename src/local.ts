import { cliMain } from "grindery-nexus-common-utils/dist/connector/local";
import { CONNECTOR_DEFINITION } from "./connector";

cliMain(CONNECTOR_DEFINITION)
  .then((result) => console.log(result))
  .catch((e) => console.error(e));
