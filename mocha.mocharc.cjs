require("dotenv").config();

module.exports = {
  timeout: 100000,
  exit: true,
  "async-only": true,
  loader: "ts-node/esm",
};
