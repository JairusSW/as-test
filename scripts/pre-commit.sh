#!/usr/bin/env bash
set -euo pipefail

echo "Building cli..."
npm run build:cli

echo "Building lib..."
npm run build:lib

echo "Building transform..."
npm run build:transform

echo "Running formatter..."
npm run format

# Ignore generated outputs and ephemeral test artifacts when checking for
# unstaged changes — the formatter will routinely touch `bin/`, `lib/build/`,
# and `transform/lib/`, and `.as-test/` holds run-time logs and snapshots
# that don't matter for the commit.
if ! git diff --quiet -- . \
  ':(exclude)bin' \
  ':(exclude)lib/build' \
  ':(exclude)transform/lib' \
  ':(exclude).as-test'; then
  echo
  echo "Formatting changed files. Review, stage, and commit those changes before committing."
  git --no-pager diff --stat -- . \
    ':(exclude)bin' \
    ':(exclude)lib/build' \
    ':(exclude)transform/lib' \
    ':(exclude).as-test'
  exit 1
fi

echo "Running typecheck..."
npm run typecheck

echo "Running linter..."
npm run lint
