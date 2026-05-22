// The current mode name is patched at build time by as-test's transform
// (transform/src/index.ts) using the AS_TEST_MODE_NAME env var that
// build-core.ts injects per-mode build. When unset, defaults to "default".
export const AS_TEST_MODE_NAME: string = "default";

function modeMatches(matchers: string[], current: string): bool {
  if (matchers.length == 0) return false;
  let sawPositive = false;
  let positiveHit = false;
  for (let i = 0; i < matchers.length; i++) {
    const m = matchers[i];
    if (m.length == 0) continue;
    if (m.charCodeAt(0) == 33 /* '!' */) {
      if (m.substring(1) == current) return false;
    } else {
      sawPositive = true;
      if (m == current) positiveHit = true;
    }
  }
  return sawPositive ? positiveHit : true;
}

/**
 * Gate a block of suite/test registrations on the current execution mode.
 *
 * The current mode is the name under `modes.<name>` in `as-test.config.json`
 * (or `"default"` when running the base config). Comparisons are by exact
 * string match.
 *
 * Matcher semantics:
 *  - `["a"]` runs when the current mode equals `"a"`.
 *  - `["a", "b"]` runs when the current mode is in `{a, b}` (positive OR).
 *  - `["!a"]` runs when the current mode is NOT `"a"`.
 *  - `["!a", "!b"]` runs when the current mode is neither `{a, b}` (AND).
 *  - Mixed `["a", "!b"]` runs when any positive matches AND no negative does.
 *  - `[]` and empty entries are skipped (no-op).
 *
 * @example
 * ```ts
 * mode(["simd"], () => {
 *   describe("vectorised path", () => { ... });
 * });
 *
 * mode(["simd", "swar"], () => {
 *   describe("fast paths", () => { ... });
 * });
 *
 * mode(["!naive"], () => {
 *   describe("anything but naive", () => { ... });
 * });
 * ```
 */
export function mode(matchers: string[], fn: () => void): void {
  if (modeMatches(matchers, AS_TEST_MODE_NAME)) fn();
}
