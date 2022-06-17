require("core-js");
require("@babel/register")({ extensions: [".js", ".jsx", ".ts", ".tsx"] });

module.exports = require("../src/index");

if (require.main === module) {
  module.exports
    .main()
    .then((x) => console.log(require("util").inspect(x, { depth: 10 })))
    .then(() => process.exit(0))
    .catch((e) => console.error(e));
}

// vim: sw=2:ts=2:expandtab:fdm=syntax
