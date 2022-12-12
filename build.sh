#!/usr/bin/env bash

set -eu

[ -d dist ] && rm -rf dist

eslint --ext js,ts src/
tsc -p tsconfig.json
