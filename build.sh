#!/usr/bin/env bash

set -eu

INSTANCE=${INSTANCE:-$npm_package_name}

# Linting and type-checking
eslint src/*.{js,ts}
tsc -p tsconfig.json --noEmit

# Build
[ -d dist ] && rm -rf dist
babel src --extensions ".ts,.js" -s inline -d dist
cp package.json dist/
cp package-lock.json dist/
cd dist
npm install --production