<h1 align="center"><pre>╔═╗ ╔═╗    ╔═╗ ╔═╗ ╔═╗ ╔═╗
╠═╣ ╚═╗ ══  ║  ╠═  ╚═╗  ║ 
╩ ╩ ╚═╝     ╩  ╚═╝ ╚═╝  ╩ </pre></h1>

<details>
<summary>Table of Contents</summary>

- [Why as-test](#why-as-test)
- [Installation](#installation)
- [Docs](#docs)
- [Examples](#examples)
- [Writing Tests](#writing-tests)
- [Fuzzing](#fuzzing)
- [Setup Diagnostics](#setup-diagnostics)
- [Mocking](#mocking)
- [Snapshots](#snapshots)
- [Coverage](#coverage)
- [Custom Reporters](#custom-reporters)
- [Assertions](#assertions)
- [CLI Style Guide](#cli-style-guide)
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

To scaffold and install dependencies in one step:
```bash
npx as-test init --dir ./path-to-install --install
```

Alternatively, you can install it manually:
```bash
npm install as-test --save-dev
```

## Docs

Deeper guides live in [docs/](./docs/README.md):

- [Getting Started](./docs/getting-started.md)
- [Writing Tests](./docs/writing-tests.md)
- [Fuzzing](./docs/fuzzing.md)
- [Mocking](./docs/mocking.md)
- [Snapshots](./docs/snapshots.md)
- [Coverage](./docs/coverage.md)
- [Custom Reporters](./docs/reporters.md)
- [Assertions](./docs/assertions.md)
- [Configuration](./docs/configuration.md)
- [CLI Guide](./docs/cli.md)
- [Setup Diagnostics](./docs/doctor.md)

## Examples

Full runnable examples live in `examples/`, including:

- one standalone project per example (initialized with `ast init`)
- complete spec files for core features
- import mocking and import snapshot patterns

See `examples/README.md` for the walkthrough.

Quick validation from this repo:

```bash
npm test
npm run test:examples
```

## Writing Tests

Create `assembly/__tests__/math.spec.ts`:

```ts
import { describe, test, expect } from "as-test";

describe("math", () => {
  test("addition", () => {
    expect(1 + 2).toBe(3);
  });

  test("close to", () => {
    expect(3.14159).toBeCloseTo(3.14, 2);
  });
});
```

### File selection (`ast run`, `ast build`, `ast test`, `ast fuzz`)

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
ast fuzz parser,json
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
- `--fuzz`: when used with `ast test`, also run configured fuzz targets after the normal test pass
- `--fuzz-runs <n>` / `--runs <n>`: override fuzz iteration count for `ast test --fuzz` / `ast fuzz`
- `--fuzz-seed <n>` / `--seed <n>`: override fuzz seed for `ast test --fuzz` / `ast fuzz`
- `--fuzz-max-input-bytes <n>` / `--max-input-bytes <n>`: override fuzz input size cap for `ast test --fuzz` / `ast fuzz`
- `--verbose`: keep expanded suite/test lines and update running `....` statuses in place
- `--clean`: disable in-place TTY updates and print only final per-file verdict lines. Useful for CI/CD.
- `--list`: show resolved files, per-mode artifacts, and runtime command without executing
- `--list-modes`: show configured and selected modes without executing
- `--help` / `-h`: show command-specific help (`ast test --help`, `ast init --help`, etc.)

Example:

```bash
ast build --enable try-as
ast test --disable coverage
```

Preview execution plan:

```bash
ast test --list
ast test --list-modes
ast run sleep --list --mode wasi
ast build --list --mode wasi,bindings
```

## Fuzzing

Fuzz targets live separately from specs, by default in `assembly/__fuzz__/*.fuzz.ts`.

Example target:

```ts
export function fuzz(data: Uint8Array): void {
  if (data.length > 3 && data[0] == 0xff) unreachable();
}
```

Built-in argument generation currently supports common exported parameter types:

- `Uint8Array`
- `ArrayBuffer`
- `string`
- `number`
- `Array<number>`
- `Array<boolean>`
- `Array<string>`
- typed arrays like `Int32Array`, `Uint16Array`, `Float64Array`

Commands:

```bash
ast fuzz
ast fuzz parser --runs 50000 --seed 42
ast fuzz ./assembly/__fuzz__/*.fuzz.ts --max-input-bytes 8192
ast test --fuzz
ast test --fuzz --fuzz-runs 50000 --fuzz-seed 42
```

Behavior:

- `ast fuzz` builds the selected fuzz targets with `bindings` and runs only the fuzz pass
- `ast test --fuzz` runs the normal spec suite first, then runs fuzz targets and appends a fuzz summary to the same console report
- crashing inputs are written to `fuzz.crashDir` as `.bin` plus `.json` metadata
- seed corpus inputs are loaded from `fuzz.corpusDir/<target-name>/`
- fuzz target files should export a function matching `export function fuzz(data: Uint8Array): void`
- per-target overrides are available from the CLI via `--runs`, `--seed`, `--max-input-bytes`, and `--entry`

### Custom Generators

If built-in argument generation is not enough, add a sibling generator module next to the target:

```text
assembly/__fuzz__/parser.fuzz.ts
assembly/__fuzz__/parser.fuzz.gen.js
```

Example target:

```ts
export function fuzz(input: string, flags: Array<number>): void {
  // ...
}
```

Example generator:

```js
export function generate(ctx) {
  const text = ctx.helpers.string(ctx.bytes);
  const flags = ctx.helpers.array.numbers(ctx.bytes.subarray(0, 16));
  return [text, flags];
}
```

Generator behavior:

- export `generate(context)` or a default function
- return one argument value for single-parameter targets
- return an array of arguments for multi-parameter targets
- `context` includes `seed`, `bytes`, `rand`, inferred target args, and `helpers`

Available helpers:

- `helpers.bytes(input)`
- `helpers.buffer(input)`
- `helpers.string(input)`
- `helpers.typedArray(typeName, input)`
- `helpers.number.i32(input)` / `helpers.number.u32(input)` / `helpers.number.f64(input)` / `helpers.number.bool(input)`
- `helpers.array.numbers(input)` / `helpers.array.booleans(input)` / `helpers.array.strings(input)`

## Setup Diagnostics

Use `ast doctor` to validate local setup before running tests.

```bash
ast doctor
```

You can also target specific modes and config files:

```bash
ast doctor --config ./as-test.config.json --mode wasi,bindings
```

`doctor` checks:

- config file loading and mode resolution
- required dependencies (for example `assemblyscript`, `@assemblyscript/wasi-shim` for WASI targets)
- runtime command parsing and executable availability
- runtime script path existence (for script-host runtimes)
- test spec file discovery from configured input patterns

If any `ERROR` checks are found, `ast doctor` exits non-zero.

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
  "output": "./.as-test/",
  "config": "none",
  "coverage": true,
  "env": {},
  "buildOptions": {
    "cmd": "",
    "args": [],
    "target": "wasi"
  },
  "fuzz": {
    "input": ["./assembly/__fuzz__/*.fuzz.ts"],
    "entry": "fuzz",
    "runs": 1000,
    "seed": 1337,
    "maxInputBytes": 4096,
    "target": "bindings",
    "corpusDir": "./.as-test/fuzz/corpus",
    "crashDir": "./.as-test/fuzz/crashes"
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
- `output`: output alias. Use a root string (`"./.as-test/"`) or object (`{ "build": "...", "logs": "...", "coverage": "...", "snapshots": "..." }`)
- `outDir`: compiled wasm output dir
- `logs`: log output dir or `"none"`
- `coverageDir`: coverage output dir or `"none"`
- `snapshotDir`: snapshot storage dir
- `outDir`, `logs`, `coverageDir`, and `snapshotDir` still work; when both are set, these explicit fields override `output`
- `env`: environment variables injected into build and runtime processes
- `buildOptions.cmd`: optional custom build command template; when set it replaces default build command and flags. Supports `<file>`, `<name>`, `<outFile>`, `<target>`, `<mode>`
- `buildOptions.target`: `wasi` or `bindings`
- `fuzz`: fuzz target configuration used by `ast fuzz` and `ast test --fuzz`
- `fuzz.input`: glob list of fuzz files (default `./assembly/__fuzz__/*.fuzz.ts`)
- `fuzz.entry`: exported fuzz function name, default `fuzz`
- `fuzz.runs` / `fuzz.seed` / `fuzz.maxInputBytes`: default driver settings for mutation count, deterministic seed, and input size cap
- `fuzz.target`: currently must be `bindings`
- `fuzz.corpusDir` / `fuzz.crashDir`: directories for seed inputs and crashing repro artifacts
- `modes`: named overrides for command/target/args/runtime/env/artifact directories (selected via `--mode`); `mode.env` overrides top-level `env`
- `runOptions.runtime.cmd`: runtime command, supports `<file>` and `<name>`; if its script path is missing, as-test falls back to the default runner for the selected target
- `runOptions.reporter`: reporter selection as a string or object

Validation behavior:

- Config parsing is strict for `ast build`, `ast run`, `ast test`, and `ast doctor`.
- Invalid JSON fails early with parser details (`line`/`column` when provided by Node).
- Unknown properties are rejected and include a nearest-key suggestion when possible.
- Invalid property types are reported with their JSON path and a short fix hint.
- On validation failure, the command exits non-zero and prints `run "ast doctor" to check your setup.`

Example validation error:

```text
invalid config at ./as-test.config.json
1. $.inpoot: unknown property
     fix: use "input" if that was intended, otherwise remove this property
2. $.runOptions.runtime.cmd: must be a string
     fix: set to a runtime command including "<file>"
run "ast doctor" to check your setup.
```

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
- `toContain(itemOrSubstring)` (`toContains` alias supported)
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
