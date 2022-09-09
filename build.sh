#!/usr/bin/env bash

set -eu

[ -d dist ] && rm -rf dist

eslint src/*.ts
tsc -p tsconfig.json
