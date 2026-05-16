#!/usr/bin/env bash
set -euo pipefail

mkdir -p .tools

if [ ! -x .tools/node/bin/node ]; then
  version="$(
    curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt \
      | grep 'linux-x64.tar.xz$' \
      | head -n1 \
      | sed -E 's/^.*node-v(.*)-linux-x64.tar.xz$/\1/'
  )"

  curl -fsSL "https://nodejs.org/dist/latest-v22.x/node-v${version}-linux-x64.tar.xz" -o .tools/node.tar.xz
  rm -rf .tools/node-download
  mkdir -p .tools/node-download
  tar -xJf .tools/node.tar.xz -C .tools/node-download --strip-components=1
  mv .tools/node-download .tools/node
  rm .tools/node.tar.xz
fi

export PATH="$PWD/.tools/node/bin:$PATH"

node --version
npm --version
