<h1 align="center"><pre>╔═╗ ╔═╗    ╔═╗ ╔═╗ ╔═╗ ╔═╗
╠═╣ ╚═╗ ══  ║  ╠═  ╚═╗  ║ 
╩ ╩ ╚═╝     ╩  ╚═╝ ╚═╝  ╩ </pre></h1>

<details>
<summary>Table of Contents</summary>

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Examples](#examples)
- [API](#api)
- [Assertions](#assertions)
- [CLI](#cli)
- [Configuration](#configuration)
- [Runtime Recipes](#runtime-recipes)
- [Snapshots](#snapshots)
- [Coverage](#coverage)
- [Custom Reporters](#custom-reporters)
- [Runtime Notes](#runtime-notes)
- [CI](#ci)
- [Contributing](#contributing)
- [License](#license)
- [Contact](#contact)

</details>

`as-test` is a lightweight test framework for AssemblyScript.

It provides a familiar `describe/test/expect` API, compiles test files to WebAssembly, runs them with your configured runtime, and prints a concise terminal report.

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

Create `assembly/__tests__/math.spec.ts`:

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

`run()` is optional. If a spec defines suites and omits `run()`, `as-test` auto-injects it at compile time.

## Examples

### Hooks and Shared Setup

```ts
import { describe, test, expect, beforeAll, afterAll, beforeEach, run } from "as-test";

let calls = 0;

beforeAll(() => {
  calls = 0;
});

afterAll(() => {
  // one-time teardown
});

beforeEach(() => {
  calls++;
});

describe("counter", () => {
  test("increments before each test", () => {
    expect(calls).toBeGreaterOrEqualTo(1);
  });

  test("runs once per test", () => {
    expect(calls).toBe(2);
  });
});

run();
```

### Snapshot Assertions

```ts
import { describe, test, expect, run } from "as-test";

describe("user payload", () => {
  test("matches default key snapshot", () => {
    expect('{"id":1,"name":"jairus"}').toMatchSnapshot();
  });

  test("matches named snapshot", () => {
    expect('{"id":2,"name":"tari"}').toMatchSnapshot("user-2");
  });
});

run();
```

Run in read-only mode:

```bash
npx as-test run --snapshot
```

Create or update snapshots:

```bash
npx as-test run --update-snapshots
```

### Custom Assertion Messages

```ts
import { describe, test, expect, run } from "as-test";

describe("price checks", () => {
  test("tax-inclusive total", () => {
    const subtotal = 100;
    const total = subtotal * 1.07;
    expect(total, "total should include 7% tax").toBe(107);
  });
});

run();
```

### Coverage Configuration

```json
{
  "coverage": {
    "enabled": true,
    "includeSpecs": false
  },
  "logs": "./.as-test/logs"
}
```

Show every coverage point in terminal:

```bash
npx as-test run --show-coverage
```

### Using WASI Runtime

```json
{
  "buildOptions": {
    "target": "wasi",
    "args": []
  },
  "runOptions": {
    "runtime": {
      "name": "node-wasi",
      "run": "node ./bin/wasi-run.js <file>"
    }
  }
}
```

### Using a Custom Reporter

```json
{
  "runOptions": {
    "reporter": "./tests/my-reporter.js"
  }
}
```

```js
// tests/my-reporter.js
export function createReporter() {
  return {
    onFileEnd(event) {
      const verdict = (event.verdict ?? "none").toUpperCase();
      process.stdout.write(`${verdict} ${event.file}\n`);
    },
  };
}
```

## API

- Suite builders:
  - `describe(name, fn)`
  - `test(name, fn)`
  - `it(name, fn)`
- Assertions:
  - `expect(value)`
  - `expect(value, message)` for custom failure context
  - Negation: `expect(value).not.<matcher>()`
- Execution:
  - `run(options?)` remains available for explicit control
  - If omitted, `as-test` auto-injects `run()` for entry specs with tests
- Hooks:
  - `beforeAll(fn)`
  - `afterAll(fn)`
  - `beforeEach(fn)`
  - `afterEach(fn)`
- Logging:
  - `log(value)` (pretty terminal-aware logging)

`beforeEach` and `afterEach` run once per test case (`test`/`it`), not once per assertion.

## Assertions

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

Snapshot and coverage flags:

- `as-test run --snapshot`: enable snapshot assertions in read-only mode
- `as-test run --update-snapshots`: create or update snapshot files
- `as-test test --snapshot`: build and run with snapshots enabled
- `as-test test --update-snapshots`: build, run, and write snapshot updates
- `as-test run --show-coverage`: print all coverage points with `line:column`

Version:

- `as-test --version`
- `as-test -v`

## Configuration

Default config file: `as-test.config.json` (generated artifacts default to `./.as-test/*`).

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
    "target": "wasi"
  },
  "runOptions": {
    "runtime": {
      "name": "node-wasi",
      "run": "node ./bin/wasi-run.js <file>"
    },
    "reporter": ""
  }
}
```

`$schema` enables editor autocomplete and validation for `as-test.config.json`.

`runOptions.reporter` is optional. Leave it empty to use the built-in reporter. If set, it must point to a JS/TS module exporting a reporter factory.

## Runtime Recipes

Each runtime command supports `<file>` (compiled wasm path) and `<name>` (spec base name).

### WASI with built-in Node runner (default)

```json
{
  "buildOptions": { "target": "wasi" },
  "runOptions": {
    "runtime": {
      "name": "node-wasi",
      "run": "node ./bin/wasi-run.js <file>"
    }
  }
}
```

### WASI with wazero

```json
{
  "buildOptions": { "target": "wasi" },
  "runOptions": {
    "runtime": {
      "name": "wazero",
      "run": "wazero run <file>"
    }
  }
}
```

### WASI with wasmtime

```json
{
  "buildOptions": { "target": "wasi" },
  "runOptions": {
    "runtime": {
      "name": "wasmtime",
      "run": "wasmtime <file>"
    }
  }
}
```

### WASI with wasmer

```json
{
  "buildOptions": { "target": "wasi" },
  "runOptions": {
    "runtime": {
      "name": "wasmer",
      "run": "wasmer run <file>"
    }
  }
}
```

### WASI with wasmedge

```json
{
  "buildOptions": { "target": "wasi" },
  "runOptions": {
    "runtime": {
      "name": "wasmedge",
      "run": "wasmedge <file>"
    }
  }
}
```

### Bindings with Node

```json
{
  "buildOptions": { "target": "bindings" },
  "runOptions": {
    "runtime": {
      "name": "node",
      "run": "node ./tests/<name>.run.js"
    }
  }
}
```

## Snapshots

- Snapshot files are written under `snapshotDir` (default: `./.as-test/snapshots/`).
- `toMatchSnapshot()` uses a deterministic key based on file, suite path, and assertion order.
- `toMatchSnapshot("name")` appends a stable suffix for multiple snapshots in one test.
- In read-only mode (`--snapshot`), missing or mismatched snapshots fail the run.
- In update mode (`--update-snapshots`), missing or mismatched snapshots are written and treated as pass.

## Coverage

- Coverage instrumentation is collected during test execution.
- Configure coverage using either:
  - `"coverage": true | false`
  - `"coverage": { "enabled": true | false, "includeSpecs": false }`
- When enabled:
  - Terminal summary prints overall point coverage.
  - `--show-coverage` prints every coverage point with hit or miss status.
  - If `logs` is not `"none"`, coverage data is written to `logs/coverage.log.json`.
- By default, `*.spec.ts` files are excluded from coverage (`includeSpecs: false`).

## Custom Reporters

`as-test` supports host-side reporter modules through `runOptions.reporter`.

See reporter extension docs and module contract in `docs/reporters.md`.

## Runtime Notes

- `buildOptions.target` supports `bindings` and `wasi`.
- For `bindings`, runtime command usually points to `tests/<name>.run.js` wrappers.
- For `wasi`, `as-test` can run modules with `node ./bin/wasi-run.js <file>`.
- External WASI runtimes work as long as they support stdin/stdout for WIPC frames.
- WASI builds still require `@assemblyscript/wasi-shim` for compile configuration.

## CI

See `.github/workflows/as-test.yml` for a working CI example.

## Contributing

Issues and pull requests are welcome: [GitHub Issues](https://github.com/JairusSW/as-test/issues).

## License

This project is distributed under the MIT license.

You can view the full license here: [LICENSE](./LICENSE).

## Contact

- **GitHub:** [JairusSW/as-test](https://github.com/JairusSW/as-test)
- **Issues:** [Open an issue](https://github.com/JairusSW/as-test/issues)
- **Email:** [me@jairus.dev](mailto:me@jairus.dev)
