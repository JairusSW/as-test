# as-test

`as-test` is a test framework for AssemblyScript with a familiar `describe/test/expect` API.

It compiles `.spec.ts` files to WebAssembly, runs them with your configured runtime, and reports per-file progress with a final aggregated summary.

## Table of Contents

- [Setup](#setup)
- [Writing Tests](#writing-tests)
- [Running Tests](#running-tests)
- [Snapshots](#snapshots)
- [Coverage](#coverage)
- [Configuration](#configuration)
- [Custom Reporter](#custom-reporter)
- [Assertions](#assertions)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Setup

### 1. Install dependencies

```bash
npx as-test init
npx as-test init ./path-to-install
npx as-test init --dir ./path-to-install
npx as-test test
```

## Writing Tests

Create `assembly/__tests__/math.spec.ts`:

```ts
import { describe, test, expect, run } from "as-test";

describe("math", () => {
  test("addition", () => {
    expect(1 + 2).toBe(3);
  });

  test("close to", () => {
    expect(3.14159).toBeCloseTo(3.14, 2);
  });
});

run();
```

`run()` can be omitted in entry specs; `as-test` injects it automatically when needed.

## Running Tests

CLI aliases:

- `as-test`
- `ast`

### Command behavior

- `ast build`
  - builds all files from configured input glob(s)
  - prints nothing on success
  - prints error-only output on failures
- `ast run`
  - runs all files from configured input glob(s)
- `ast test`
  - resolves selected spec files
  - executes **sequentially per file** as `build #1 -> run #1 -> build #2 -> run #2 ...`
  - prints one final summary after all files complete

### Test file selection (`ast test`)

No selectors:

```bash
ast test
```

Uses configured input patterns from `as-test.config.json`.

By name:

```bash
ast test sleep
```

Resolves to `<configured-input-dir>/sleep.spec.ts`.

By explicit path or glob:

```bash
ast test ./assembly/__tests__/sleep.spec.ts
ast test ./assembly/__tests__/*.spec.ts
```

Multiple selectors:

```bash
ast test sleep array ./assembly/__tests__/snapshot.spec.ts
```

If nothing matches, `ast test` exits non-zero with:

```text
No test files matched: ...
```

### Useful flags

- `--config <path>`: use another config file
- `--update-snapshots`: write snapshot updates
- `--no-snapshot`: disable snapshot assertions for the run
- `--show-coverage`: print uncovered coverage points
- `--clean`: cleaner output mode

## Snapshots

Snapshot assertions are enabled by default.

- Read-only mode (default): missing/mismatched snapshots fail
- Update mode: `--update-snapshots` writes missing/mismatched snapshots

Commands:

```bash
ast test --update-snapshots
ast run --update-snapshots
ast test --no-snapshot
```

Snapshot files are stored in `snapshotDir` (default `./.as-test/snapshots`).

## Coverage

Coverage is controlled by `coverage` in config.
Coverage reporting includes source files ending in `.ts` or `.as` only.

- Boolean form:
  - `true` / `false`
- Object form:
  - `{ "enabled": true, "includeSpecs": false }`

Default behavior includes non-spec files and excludes `*.spec.ts` files.

Show point-level misses:

```bash
ast test --show-coverage
```

Coverage artifacts:

- `ast run` writes `coverage.log.json` to `coverageDir` (if enabled and not `"none"`)
- `ast test` writes per-file coverage artifacts (`coverage.<file>.log.json`)

Log artifacts:

- `ast run` writes `test.log.json` to `logs` (if `logs` is not `"none"`)
- `ast test` writes per-file logs (`test.<file>.log.json`)

## Configuration

Default file: `as-test.config.json`

Example:

```json
{
  "$schema": "./as-test.config.schema.json",
  "input": ["./assembly/__tests__/*.spec.ts"],
  "outDir": "./.as-test/build",
  "logs": "./.as-test/logs",
  "coverageDir": "./.as-test/coverage",
  "snapshotDir": "./.as-test/snapshots",
  "config": "none",
  "coverage": true,
  "buildOptions": {
    "args": [],
    "target": "wasi"
  },
  "runOptions": {
    "runtime": {
      "cmd": "node ./.as-test/runners/default.wasi.js <file>"
    },
    "reporter": ""
  }
}
```

Key fields:

- `input`: glob list of spec files
- `outDir`: compiled wasm output dir
- `logs`: log output dir or `"none"`
- `coverageDir`: coverage output dir or `"none"`
- `snapshotDir`: snapshot storage dir
- `buildOptions.target`: `wasi` or `bindings`
- `runOptions.runtime.cmd`: runtime command, supports `<file>` and `<name>`
- `runOptions.reporter`: optional custom reporter module path

## Custom Reporter

Set reporter path in config:

```json
{
  "runOptions": {
    "reporter": "./tests/my-reporter.js"
  }
}
```

Reporter module should export `createReporter` (named or default):

```js
export function createReporter(context) {
  return {
    onRunStart(event) {},
    onFileStart(event) {},
    onFileEnd(event) {},
    onSuiteStart(event) {},
    onSuiteEnd(event) {},
    onAssertionFail(event) {},
    onSnapshotMissing(event) {},
    onRunComplete(event) {},
  };
}
```

## Assertions

Skip helpers:

- `xdescribe(name, fn)`
- `xtest(name, fn)`
- `xit(name, fn)`
- `xexpect(value)`

Available matchers:

- `toBe(expected)`
- `toBeNull()`
- `toBeGreaterThan(value)`
- `toBeGreaterOrEqualTo(value)`
- `toBeLessThan(value)`
- `toBeLessThanOrEqualTo(value)`
- `toBeString()`
- `toBeBoolean()`
- `toBeArray()`
- `toBeNumber()`
- `toBeInteger()`
- `toBeFloat()`
- `toBeFinite()`
- `toBeTruthy()`
- `toBeFalsy()`
- `toBeCloseTo(expected, precision = 2)`
- `toMatch(substring)`
- `toStartWith(prefix)`
- `toEndWith(suffix)`
- `toHaveLength(length)`
- `toContain(item)`
- `toThrow()` (with `try-as`)
- `toMatchSnapshot(name?)`

## Troubleshooting

- `could not find json-as`:
  - install `json-as` as a dev dependency
- `could not find @assemblyscript/wasi-shim`:
  - install `@assemblyscript/wasi-shim` when using `wasi`
- `No test files matched: ...`:
  - verify `input` globs or selector arguments
- `Failed to build file.spec.ts with ...`:
  - check compile error output from AssemblyScript in stderr

## Contributing

Issues and PRs are welcome:

- https://github.com/JairusSW/as-test/issues

## License

MIT, see [LICENSE](./LICENSE).
