#!/usr/bin/env bash
set -euo pipefail

if command -v bun >/dev/null 2>&1; then
  bun run test:ci
else
  npm run test:ci
fi
