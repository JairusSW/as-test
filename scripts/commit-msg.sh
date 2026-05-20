#!/usr/bin/env bash
set -euo pipefail

msg_file="${1:-}"
if [ -z "$msg_file" ] || [ ! -f "$msg_file" ]; then
  echo "commit-msg hook requires the commit message file path."
  exit 1
fi

msg="$(head -n 1 "$msg_file" | tr -d '\r')"

pattern='^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([[:alnum:]_.\/-]+\))?(!)?: .+'

if ! printf '%s\n' "$msg" | grep -Eq "$pattern"; then
  cat <<'EOF'
Commit message must follow Conventional Commits:
  <type>(optional-scope): description

Examples:
  feat: directory-preserving artifact layout
  fix(coverage): handle ~lib/<pkg> normalized paths
  chore!: drop legacy snap.json fallback
EOF
  exit 1
fi
