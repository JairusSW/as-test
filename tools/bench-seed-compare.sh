#!/usr/bin/env bash
set -euo pipefail

runs="${1:-7}"
if ! [[ "$runs" =~ ^[0-9]+$ ]] || [ "$runs" -lt 1 ]; then
  echo "runs must be a positive integer" >&2
  exit 1
fi

times_ms=()

for i in $(seq 1 "$runs"); do
  out="$(node ./bin/index.js fuzz --config ./as-test.bench.config.json --clean)"
  line="$(printf '%s\n' "$out" | sed -n 's/^Time:[[:space:]]\+\([0-9.]\+\)\(ms\|s\).*/\1 \2/p' | tail -n 1)"
  if [ -z "$line" ]; then
    echo "failed to parse benchmark time on run $i" >&2
    exit 1
  fi
  value="$(printf '%s' "$line" | awk '{print $1}')"
  unit="$(printf '%s' "$line" | awk '{print $2}')"
  if [ "$unit" = "s" ]; then
    ms="$(awk -v v="$value" 'BEGIN { printf "%.3f", v * 1000 }')"
  else
    ms="$(awk -v v="$value" 'BEGIN { printf "%.3f", v }')"
  fi
  times_ms+=("$ms")
  pretty="$(awk -v ms="$ms" 'BEGIN { if (ms >= 1000) printf "%.3fs", ms / 1000; else printf "%.1fms", ms }')"
  printf 'run %2d: %s\n' "$i" "$pretty"
done

sorted="$(printf '%s\n' "${times_ms[@]}" | sort -n)"
min="$(printf '%s\n' "$sorted" | sed -n '1p')"
max="$(printf '%s\n' "$sorted" | tail -n 1)"
median_index=$(( (runs + 1) / 2 ))
median="$(printf '%s\n' "$sorted" | sed -n "${median_index}p")"
p95_index=$(( (95 * runs + 99) / 100 ))
if [ "$p95_index" -lt 1 ]; then p95_index=1; fi
if [ "$p95_index" -gt "$runs" ]; then p95_index="$runs"; fi
p95="$(printf '%s\n' "$sorted" | sed -n "${p95_index}p")"
mean="$(printf '%s\n' "${times_ms[@]}" | awk '{s+=$1} END { printf "%.3f", s / NR }')"

fmt() {
  awk -v ms="$1" 'BEGIN { if (ms >= 1000) printf "%.3fs", ms / 1000; else printf "%.1fms", ms }'
}

echo
echo "runs:   $runs"
echo "min:    $(fmt "$min")"
echo "median: $(fmt "$median")"
echo "p95:    $(fmt "$p95")"
echo "mean:   $(fmt "$mean")"
echo "max:    $(fmt "$max")"
