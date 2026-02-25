<h1 align="center"><pre>╔═╗ ╔═╗    ╔═╗ ╔═╗ ╔═╗ ╔═╗
╠═╣ ╚═╗ ══  ║  ╠═  ╚═╗  ║ 
╩ ╩ ╚═╝     ╩  ╚═╝ ╚═╝  ╩ </pre></h1>

<details>
<summary>Table of Contents</summary>

- [Why as-test](#why-as-test)
- [Installation](#installation)
- [Examples](#examples)
- [Writing Tests](#writing-tests)
- [Mocking](#mocking)
- [Snapshots](#snapshots)
- [Coverage](#coverage)
- [Custom Reporters](#custom-reporters)
- [Assertions](#assertions)
- [License](#license)
- [Contact](#contact)

</details>

## Why as-test

Most AssemblyScript testing tools are tied to a single runtime, usually Node.js. This works for development, but it doesn’t reflect how your code runs in production.
If you deploy to WASI, Wazero, or a custom runtime, you often end up mocking everything and maintaining parallel logic just for tests.
as-test solves this by letting you run tests on your actual target runtime, while only mocking what’s necessary.

Key benefits

- Runtime-agnostic: test on WASI, bindings, or custom runners
- Minimal mocking: keep real imports when possible
- Production-like testing: catch runtime-specific issues early
- Inline mocking and snapshots
- Custom reporters and coverage

## Installation

The installation script will set everything up for you:
```bash
npx as-test init --dir ./path-to-install
```

Alternatively, you can install it manually:
```bash
npm install as-test --save-dev
```

## Examples

Full runnable examples live in `examples/`, including:

- complete spec files for core features
- import mocking and import snapshot patterns
- mode-based runtime matrix config in `examples/as-test.config.json`
- a dedicated config you can run directly

See `examples/README.md` for the walkthrough.

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
```

### File selection (`ast run`, `ast build`, `ast test`)

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

Comma-separated bare suite names:

```bash
ast test box,custom,generics,string
ast run box,custom,generics,string
ast build box,custom,generics,string
```

If nothing matches, `ast test` exits non-zero with:

```text
No test files matched: ...
```

### Useful flags

- `--config <path>`: use another config file
- `--mode <name[,name...]>`: run one or multiple named config modes (if omitted and `modes` is configured, as-test runs all configured modes)
- `--update-snapshots`: write snapshot updates
- `--no-snapshot`: disable snapshot assertions for the run
- `--show-coverage`: print uncovered coverage points
- `--enable <feature>`: enable as-test feature (`coverage`, `try-as`)
- `--disable <feature>`: disable as-test feature (`coverage`, `try-as`)
- `--verbose`: keep expanded suite/test lines and update running `....` statuses in place
- `--clean`: disable in-place TTY updates and print only final per-file verdict lines. Useful for CI/CD.

Example:

```bash
ast build --enable try-as
ast test --disable coverage
```

## Mocking

Use these helpers when you need to replace behavior during tests:

- `mockFn(oldFn, newFn)`: rewrites subsequent calls to `oldFn` in the same spec file to use `newFn`
- `unmockFn(oldFn)`: stops that rewrite for subsequent calls
- `mockImport("module.field", fn)`: sets the runtime mock for an external import
- `unmockImport("module.field")`: clears the runtime mock for an external import
- `snapshotImport<T = Function | string>(imp: T, version: string | i32)`: snapshots a single import mock
- `snapshotImport<T = Function | string>(imp: T, capture: () => unknown)`: runs `capture` and snapshots using version `"default"`
- `restoreImport<T = Function | string>(imp: T, version: string | i32)`: restores a single import mock

Example:

```ts
import {
  expect,
  it,
  mockFn,
  mockImport,
  restoreImport,
  run,
  snapshotImport,
  unmockFn,
  unmockImport,
} from "as-test";
import { foo } from "./mock";

mockImport("mock.foo", (): string => "buz");
mockFn(foo, (): string => "baz " + foo());

it("mocked function", () => {
  expect(foo()).toBe("baz buz");
});

unmockFn(foo);

it("function restored", () => {
  expect(foo()).toBe("buz");
});

snapshotImport(foo, 1);
mockImport("mock.foo", (): string => "temp");
snapshotImport("mock.foo", "v2");
restoreImport(foo, 1);

snapshotImport("mock.foo", () => foo()); // snapshots to version "default"
restoreImport("mock.foo", "default");

unmockImport("mock.foo");
mockImport("mock.foo", (): string => "buz");

run();
```

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
  "env": {},
  "buildOptions": {
    "cmd": "",
    "args": [],
    "target": "wasi"
  },
  "modes": {},
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
- `env`: environment variables injected into build and runtime processes
- `buildOptions.cmd`: optional custom build command template; when set it replaces default build command and flags. Supports `<file>`, `<name>`, `<outFile>`, `<target>`, `<mode>`
- `buildOptions.target`: `wasi` or `bindings`
- `modes`: named overrides for command/target/args/runtime/env/artifact directories (selected via `--mode`); `mode.env` overrides top-level `env`
- `runOptions.runtime.cmd`: runtime command, supports `<file>` and `<name>`; if its script path is missing, as-test falls back to the default runner for the selected target
- `runOptions.reporter`: reporter selection as a string or object

Example multi-runtime matrix:

```json
{
  "modes": {
    "wasi-simd": {
      "buildOptions": {
        "target": "wasi",
        "args": ["--enable", "simd"]
      },
      "runOptions": {
        "runtime": {
          "cmd": "wasmer run <file>"
        }
      }
    },
    "wasi-nosimd": {
      "buildOptions": {
        "target": "wasi"
      },
      "runOptions": {
        "runtime": {
          "cmd": "wasmer run <file>"
        }
      }
    },
    "bindings-node-simd": {
      "buildOptions": {
        "target": "bindings",
        "args": ["--enable", "simd"]
      },
      "runOptions": {
        "runtime": {
          "cmd": "node ./.as-test/runners/default.bindings.js <file>"
        }
      }
    }
  }
}
```

Run all modes:

```bash
ast test --mode wasi-simd,wasi-nosimd,bindings-node-simd
```

Summary totals:

- `Modes` in the default reporter is config-scoped (`total` is all configured modes)
- when selecting fewer modes with `--mode`, unselected modes are counted as `skipped`
- `Files` in the default reporter is also config-scoped (`total` is all files from configured input patterns)
- when selecting fewer files, unselected files are counted as `skipped`

When using `--mode`, compiled artifacts are emitted as:

```text
<test-name>.<mode>.<target>.wasm
```

Example:

```text
math.wasi-simd.wasi.wasm
math.bindings-node-simd.bindings.wasm
```

Bindings runner naming:

- preferred: `./.as-test/runners/default.bindings.js`
- deprecated but supported: `./.as-test/runners/default.run.js`

`ast init` now scaffolds both local runners:

- `.as-test/runners/default.wasi.js`
- `.as-test/runners/default.bindings.js`

## Custom Reporters

Built-in TAP reporter (useful for CI, including GitHub Actions):

```bash
ast run --reporter tap
```

TAP output is written to `./.as-test/reports/report.tap` by default.

Or in config:

```json
{
  "runOptions": {
    "reporter": "tap"
  }
}
```

Or with reporter object config:

```json
{
  "runOptions": {
    "reporter": {
      "name": "tap",
      "options": ["single-file"],
      "outDir": "./.as-test/reports"
    }
  }
}
```

`options` supports `single-file` (default) and `per-file`.

Single-file explicit path:

```json
{
  "runOptions": {
    "reporter": {
      "name": "tap",
      "outFile": "./.as-test/reports/report.tap"
    }
  }
}
```

In GitHub Actions, failed TAP points emit `::error` annotations with file and line when available.

Example GitHub workflow (Bun + Wasmtime + TAP summary):

```yaml
name: Run Tests

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: jcbhmr/setup-wasmtime@v2
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run test --update-snapshots --tap
      - uses: test-summary/action@v2
        if: always()
        with:
          paths: ".as-test/reports/*.tap"
```

Set reporter path in config:

```json
{
  "runOptions": {
    "reporter": "./tests/my-reporter.js"
  }
}
```

It's even possible to use something like [tap-summary](https://github.com/zoubin/tap-summary) to summarize the test results!

```bash
npm install -g tap-summary
ast test --reporter tap | tap-summary
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

With these hooks, you can emit machine-readable output (for example TAP/JSON) while still keeping the default human-readable terminal view for local runs.

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

## License

This project is distributed under an open source license. Work on this project is done by passion, but if you want to support it financially, you can do so by making a donation to the project's [GitHub Sponsors](https://github.com/sponsors/JairusSW) page.

You can view the full license using the following link: [License](./LICENSE)

## Contact

Please send all issues to [GitHub Issues](https://github.com/JairusSW/as-test/issues) and to converse, please send me an email at [me@jairus.dev](mailto:me@jairus.dev)

- **Email:** Send me inquiries, questions, or requests at [me@jairus.dev](mailto:me@jairus.dev)
- **GitHub:** Visit the official GitHub repository [Here](https://github.com/JairusSW/as-test)
- **Website:** Visit my official website at [jairus.dev](https://jairus.dev/)
- **Discord:** Contact me at [My Discord](https://discord.com/users/600700584038760448) or on the [AssemblyScript Discord Server](https://discord.gg/assemblyscript/)
