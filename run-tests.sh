#!/usr/bin/env bash
set -euo pipefail

if command -v bun >/dev/null 2>&1; then
  bun run test --tap
else
  npm run test -- --tap
fi
