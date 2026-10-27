#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js is required. See README.md for setup.'
  read '?Press Return to close.'
  exit 1
fi
if [ ! -d node_modules ]; then
  echo 'Dependencies are not installed. Run npm ci in this folder first.'
  read '?Press Return to close.'
  exit 1
fi
echo 'Margin is opening at http://127.0.0.1:5173/'
echo 'Keep this window open while using Margin. Press Control+C to stop.'
npm run dev -- --open
