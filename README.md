# as-test

A lightweight test framework for AssemblyScript.

`as-test` provides a familiar `describe/test/expect` API, compiles test files to WebAssembly, runs them with your configured runtime, and prints a concise terminal report.

For bindings-based runs, result reporting is host-driven over WIPC. The guest runtime emits only WIPC frames and panic/abort output.

## Installation

```bash
npm install --save-dev as-test json-as
```

Initialize a starter layout:

```bash
npx as-test init
```

## Quick Start

Create a spec file in `assembly/__tests__/math.spec.ts`:

```ts
import { describe, test, expect, run } from "as-test";

describe("math", () => {
  test("addition", () => {
    expect(1 + 2).toBe(3);
  });

  test("approx", () => {
    expect(3.14159).toBeCloseTo(3.14, 2);
  });
});

run({ log: false });
```

Run tests:

```bash
npx as-test test
```

## Core API

- Suite builders:
  - `describe(name, fn)`
  - `test(name, fn)`
  - `it(name, fn)`
- Assertions:
  - `expect(value)`
  - `expect(value, message)` for custom failure context
  - Negation: `expect(value).not.<matcher>()`
- Hooks:
  - `beforeAll(fn)`
  - `afterAll(fn)`
  - `beforeEach(fn)`
  - `afterEach(fn)`
- Logging:
  - `log(value)` (pretty terminal-aware logging)

`beforeEach` and `afterEach` run once per test case (`test`/`it`), not once per assertion.

## Assertion Matchers

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
- `toHaveLength(length)`
- `toContain(item)`
- `toMatchSnapshot(name?)`

Detailed matcher notes and examples: `docs/assertions.md`.

## CLI

Commands:

- `as-test build`: compile test specs to artifacts in `outDir`
- `as-test run`: execute compiled tests with configured runtime
- `as-test test`: build, then run
- `as-test init`: scaffold test setup

Snapshot flags:

- `as-test run --snapshot`: enable snapshot assertions in read-only mode
- `as-test run --update-snapshots`: create/update snapshot files
- `as-test test --snapshot`: build + run with snapshots enabled
- `as-test test --update-snapshots`: build + run + write snapshot updates
- `as-test run --show-coverage`: print all coverage points with line:column references

Version:

- `as-test --version`
- `as-test -v`

## Configuration

Default config file: `as-test.config.json` (generated artifacts default to `./.as-test/*`)

Example:

```json
{
  "$schema": "./as-test.config.schema.json",
  "input": ["./assembly/__tests__/*.spec.ts"],
  "outDir": "./.as-test/build",
  "logs": "./.as-test/logs",
  "snapshotDir": "./.as-test/snapshots",
  "config": "none",
  "coverage": false,
  "buildOptions": {
    "args": [],
    "target": "bindings"
  },
  "runOptions": {
    "runtime": {
      "name": "node",
      "run": "node ./tests/<name>.run.js"
    },
    "reporter": ""
  }
}
```

`$schema` enables editor autocomplete and validation for `as-test.config.json`.

`runOptions.reporter` is optional. Leave it empty to use the built-in reporter.
If set, it must point to a JS/TS module exporting a reporter factory (see `docs/reporters.md`).

## Runtime Notes

- `buildOptions.target` supports `bindings` and `wasi`.
- For `bindings`, runtime command usually points to `tests/<name>.run.js` wrappers.
- For `wasi`, install `@assemblyscript/wasi-shim`.

## Snapshots

- Snapshot files are written under `snapshotDir` (default: `./.as-test/snapshots/`).
- `toMatchSnapshot()` uses a deterministic key based on file, suite path, and assertion order.
- `toMatchSnapshot("name")` appends a stable suffix for multiple snapshots in one test.
- In read-only mode (`--snapshot`), missing/mismatched snapshots fail the run.
- In update mode (`--update-snapshots`), missing/mismatched snapshots are written and treated as pass.

## Coverage

- Coverage instrumentation is collected during test execution.
- Configure coverage using either:
  - `"coverage": true|false`
  - `"coverage": { "enabled": true|false, "includeSpecs": false }`
- When enabled:
  - Terminal summary prints overall point coverage.
  - `--show-coverage` prints every coverage point with `line:column` and hit/miss status.
  - If `logs` is not `"none"`, coverage data is written to `logs/coverage.log.json`.
- By default, `*.spec.ts` files are excluded from coverage (`includeSpecs: false`).

## CI

See `.github/workflows/as-test.yml` for a working CI example.

## Custom Reporters

Reporter extension docs and module contract:

- `docs/reporters.md`

## License

MIT. See `LICENSE`.
