#!/usr/bin/env bash

set -eu

INSTANCE=${1:-$npm_package_name}

export INSTANCE

npm run build
cd dist
gcloud functions deploy $INSTANCE --runtime nodejs16 --trigger-http