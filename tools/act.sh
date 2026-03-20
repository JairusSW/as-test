#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EVENT="${1:-push}"
shift || true

if ! command -v act >/dev/null 2>&1; then
  echo "act is not installed. Install https://github.com/nektos/act first." >&2
  exit 1
fi

cd "$ROOT_DIR"

act "$EVENT" -W .github/workflows/as-test.yml "$@"
act "$EVENT" -W .github/workflows/examples.yml "$@"
