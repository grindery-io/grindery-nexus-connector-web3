#!/bin/sh

./build.sh

echo ">> Deploying contract"

# near dev-deploy --wasmFile ./target/wasm32-unknown-unknown/release/contract.wasm

near deploy --accountId tcoratger.testnet --wasmFile ./target/wasm32-unknown-unknown/release/contract.wasm