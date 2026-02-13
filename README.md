# as-test

A lightweight test framework for AssemblyScript.

`as-test` provides a familiar `describe/test/expect` API, compiles test files to WebAssembly, runs them with your configured runtime, and prints a concise terminal report.

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

Detailed matcher notes and examples: `docs/assertions.md`.

## CLI

Commands:

- `as-test build`: compile test specs to artifacts in `outDir`
- `as-test run`: execute compiled tests with configured runtime
- `as-test test`: build, then run
- `as-test init`: scaffold test setup

Version:

- `as-test --version`
- `as-test -v`

## Configuration

Default config file: `as-test.config.json`

Example:

```json
{
  "input": ["./assembly/__tests__/*.spec.ts"],
  "outDir": "./build",
  "logs": "./logs",
  "config": "none",
  "plugins": {
    "coverage": false
  },
  "buildOptions": {
    "args": [],
    "target": "bindings"
  },
  "runOptions": {
    "runtime": {
      "name": "node",
      "run": "node ./tests/<name>.run.js"
    }
  }
}
```

## Runtime Notes

- `buildOptions.target` supports `bindings` and `wasi`.
- For `bindings`, runtime command usually points to `tests/<name>.run.js` wrappers.
- For `wasi`, install `@assemblyscript/wasi-shim`.

## CI

See `.github/workflows/as-test.yml` for a working CI example.

## License

MIT. See `LICENSE`.
