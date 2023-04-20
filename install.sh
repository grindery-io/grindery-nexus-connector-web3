#!/bin/sh

# Fix error with BSC
# https://github.com/ChainSafe/web3.js/issues/3936
sed -i 's|tx.gas = utils.hexToNumber|tx.gas = (typeof tx.gas === "string" \&\& /^0x/i.test(tx.gas) \&\& tx.gas.length > Number.MAX_SAFE_INTEGER.toString(16).length + 1) ? outputBigNumberFormatter(tx.gas) : utils.hexToNumber|' node_modules/web3-core-helpers/lib/formatters.js

# Better error message
sed -i 's|callback(errors.InvalidResponse(response))|callback(error)|' node_modules/web3-providers-http/lib/index.js