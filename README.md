<h1 align="center"><pre>╔═╗ ╔═╗    ╔═╗ ╔═╗ ╔═╗ ╔═╗
╠═╣ ╚═╗ ══  ║  ╠═  ╚═╗  ║ 
╩ ╩ ╚═╝     ╩  ╚═╝ ╚═╝  ╩ </pre></h1>

<details>
<summary>Table of Contents</summary>

- [Why as-test](#why-as-test)
- [Installation](#installation)
- [Docs](#docs)
- [Writing Tests](#writing-tests)
- [Assertions](#assertions)
- [Lifecycle Hooks](#lifecycle-hooks)
- [Mocking](#mocking)
- [Snapshots](#snapshots)
- [Runtimes](#runtimes)
- [Modes](#modes)
- [Coverage](#coverage)
- [Fuzzing](#fuzzing)
- [CLI Reference](#cli-reference)
- [Examples](#examples)
- [License](#license)

</details>

## Why as-test

Most AssemblyScript testing tools are tied to a single runtime, usually Node.js. This works for development, but it doesn’t reflect how your code runs in production.
If you deploy to WASI, Wazero, or a custom runtime, you often end up mocking everything and maintaining parallel logic just for tests.
as-test solves this by letting you run tests on your actual target runtime, while only mocking what’s necessary.

## Installation

The easiest way to start is with the project initializer:

```bash
npx as-test init
```

That gives you a basic config file, a sample test, and optionally a sample fuzzer.

If you already have a project and just want the package:

```bash
npm install --save-dev as-test
```

## Docs

Full documentation lives at:

<https://docs.jairus.dev/as-test>

## Writing Tests

Tests usually live in `assembly/__tests__/*.spec.ts`.

Example:

```ts
import { describe, expect, test } from "as-test";

describe("math", () => {
  test("adds numbers", () => {
    expect(1 + 2).toBe(3, "should add two numbers");
  });
});
```

Run everything:

```bash
npx ast test
```

Run through the automatic worker pool:

```bash
npx ast test --parallel
```

Run one matching file:

```bash
npx ast test math
```

Re-run one suite inside a matching file:

```bash
npx ast run math --suite math
npx ast run math --suite math/adds-numbers
```

You do not need to learn every CLI flag to get started. Most projects can begin with `npx ast test`, then add more configuration only when they need it.

### Suites and skipping

`describe`, `test`, and `it` register suites and cases (`test` and `it` are aliases of `describe`). Prefix any of them with `x` to skip — `xdescribe`, `xtest`, `xit` — or use `todo("...")` for an unimplemented placeholder. Focus a run on specific cases with `only(...)` (and `xonly(...)` to skip a focused case); when any `only` is present, only `only` cases run.

## Assertions

`expect(value)` returns an expectation you chain a matcher onto. Every matcher takes an optional trailing `message` string and returns the expectation, so calls can be chained. Prefix any matcher with `.not` to invert it.

```ts
expect(total).toBe(3);
expect(total).not.toBe(4);
expect(name).toContain("demo", "name should include the demo marker");
```

**Equality**

| Matcher                   | Asserts                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `toBe(expected)`          | Structural equality — `===` for primitives/strings, deep equality for managed types |
| `toEqual(expected)`       | Alias for `toBe`                                                                    |
| `toStrictEqual(expected)` | Like `toBe`, but the runtime type id must also match                                |

**Numbers**

| Matcher                                          | Asserts                                            |
| ------------------------------------------------ | -------------------------------------------------- |
| `toBeGreaterThan(n)` / `toBeGreaterOrEqualTo(n)` | `value > n` / `value >= n`                         |
| `toBeLessThan(n)` / `toBeLessThanOrEqualTo(n)`   | `value < n` / `value <= n`                         |
| `toBeCloseTo(expected, precision = 2)`           | Float is within `0.5 / 10^precision` of `expected` |

**Type and truthiness**

| Matcher                                          | Asserts                                                                |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| `toBeString()` / `toBeBoolean()` / `toBeArray()` | Value is of that kind                                                  |
| `toBeNumber()` / `toBeInteger()` / `toBeFloat()` | Value is numeric / an integer / a float                                |
| `toBeFinite()`                                   | Float is not `Infinity`/`NaN`                                          |
| `toBeNull()`                                     | Value is `null`                                                        |
| `toBeTruthy()` / `toBeFalsy()`                   | Value is truthy / falsy (empty string, `0`, `null`, `false` are falsy) |

**Strings and collections**

| Matcher                                     | Asserts                                              |
| ------------------------------------------- | ---------------------------------------------------- |
| `toMatch(substr)`                           | String contains `substr`                             |
| `toStartWith(prefix)` / `toEndWith(suffix)` | String prefix / suffix                               |
| `toHaveLength(n)`                           | Array length is `n`                                  |
| `toContain(value)` (alias `toContains`)     | Array contains `value`, or string contains substring |

**Snapshots and errors**

| Matcher                  | Asserts                                                                          |
| ------------------------ | -------------------------------------------------------------------------------- |
| `toMatchSnapshot(name?)` | Serialized value matches the stored snapshot (see [Snapshots](#snapshots))       |
| `toThrow()`              | The wrapped `() => void` callback threw — requires `--enable try-as` (see below) |

```ts
// toThrow wraps a callback and needs the try-as feature enabled.
expect((): void => {
  throw new Error("boom");
}).toThrow();
```

**Modifiers**

- `.not` — negate the next matcher.
- `.skip()` — skip this single expectation (also available as `xexpect(value)`).
- `.where(predicate, message?)` — assert on a custom `bool` or `() => bool`, for hand-written comparators.

> Not currently supported: `async`/Promise tests (AssemblyScript is synchronous), `toThrow` with an expected message/type, `toMatchObject`, user-registered custom matchers, per-test timeouts, and parameterized (`.each`) tables.

## Lifecycle Hooks

```ts
import { afterAll, afterEach, beforeAll, beforeEach } from "as-test";

beforeAll(() => {
  /* once, before any suite in the file */
});
afterAll(() => {
  /* once, after every suite in the file */
});
beforeEach(() => {
  /* before each test case */
});
afterEach(() => {
  /* after each test case */
});
```

`beforeAll`/`afterAll` run once per file. `beforeEach`/`afterEach` run around each **test case** (`test`/`it`/`only` and their `x` variants) — not around grouping `describe` blocks. To run them around other block kinds, pass a `kinds` array, e.g. `beforeEach(() => {...}, ["describe", "test"])`.

## Mocking

Mocking is supported, but the idea is to use it sparingly.

With `as-test`, the ideal path is to run your code against the real runtime and real imports when you can. When that is not practical, you can mock individual imports instead of rebuilding your whole environment around fake behavior.

For local functions, use `mockFn` and `unmockFn`. For host imports, use `mockImport` and `unmockImport`.

That is especially useful when:

- an import talks to the outside world
- a host function is hard to reproduce in a test
- you want to force an edge case that is difficult to trigger naturally

This keeps tests focused. You can still verify the logic in your AssemblyScript code without needing every runtime dependency to be real in every test. It also pairs well with snapshots when you want to capture the output of a mocked import and make sure it stays stable over time.

Example:

```ts
import { describe, expect, mockFn, test, unmockFn } from "as-test";

function getConfig(): string {
  return "name=prod\nmode=live";
}

mockFn(getConfig, (): string => "name=demo\nmode=test");

describe("config", () => {
  test("reads mocked data", () => {
    expect(getConfig()).toContain("demo");
  });
});

unmockFn(getConfig);
```

For import mocking, the same idea applies, but it is usually easier to keep the imported function in a small wrapper module and mock that import path from the spec.

## Snapshots

Snapshots are useful when the output matters more than the exact step-by-step assertions.

They work well for:

- generated strings or structured text
- serialized values
- the output of mocked imports
- larger results that would be awkward to check field by field

That lets you keep tests readable while still locking down behavior that should not change unexpectedly.

Example:

```ts
import { describe, expect, test } from "as-test";

function renderReport(): string {
  return "name=demo\nmode=test";
}

describe("report", () => {
  test("matches the saved output", () => {
    expect(renderReport()).toMatchSnapshot();
  });
});
```

The first time you run a snapshot test, create the snapshot with:

```bash
npx ast test --create-snapshots
```

After that, a normal `npx ast test` will verify it.

If an existing snapshot legitimately changed, overwrite it with:

```bash
npx ast test --overwrite-snapshots
```

## Runtimes

One of the main reasons to use `as-test` is that you are not locked into a single runtime.

If your project runs under WASI, bindings, or a custom runner, you can point your tests at that environment instead of treating Node.js as the only way to execute them.

For example, a simple WASI setup in `as-test.config.json` can look like this:

```json
{
  "input": ["./assembly/__tests__/*.spec.ts"],
  "buildOptions": {
    "target": "wasi"
  },
  "runOptions": {
    "runtime": {
      "cmd": "node ./.as-test/runners/default.wasi.js"
    }
  }
}
```

Then run your tests normally:

```bash
npx ast test
```

If you want to keep a single runtime, one config is enough. If you want to fan out across multiple runtimes, use modes.

## Modes

Modes let one project keep more than one runtime or build target available at the same time.

For example:

```json
{
  "input": ["./assembly/__tests__/*.spec.ts"],
  "modes": {
    "wasi": {
      "default": true,
      "buildOptions": {
        "target": "wasi"
      },
      "runOptions": {
        "runtime": {
          "cmd": "node ./.as-test/runners/default.wasi.js"
        }
      }
    },
    "bindings": {
      "default": true,
      "buildOptions": {
        "target": "bindings"
      },
      "runOptions": {
        "runtime": {
          "cmd": "node ./.as-test/runners/default.bindings.js"
        }
      }
    }
  }
}
```

Set `"default": false` on a mode when you want to keep it available for explicit `--mode ...` runs without including it in normal runs:

```json
{
  "modes": {
    "web": {
      "default": false,
      "buildOptions": {
        "target": "web"
      },
      "runOptions": {
        "runtime": {
          "cmd": "node ./.as-test/runners/default.web.js",
          "browser": "chromium"
        }
      }
    }
  }
}
```

With that setup:

```bash
npx ast test
```

runs the root/default config plus any modes whose `"default"` flag is not `false`, while:

```bash
npx ast test --mode web
```

still runs the `web` mode explicitly.

Modes can also be full config objects. That means a mode can override fuzzing, input globs, output aliases, runtime, build flags, and the rest of the normal config surface:

```json
{
  "modes": {
    "web": {
      "fuzz": {
        "input": ["./assembly/__fuzz__/web/*.fuzz.ts"],
        "runs": 200
      },
      "buildOptions": {
        "target": "web"
      },
      "runOptions": {
        "runtime": {
          "cmd": "node ./.as-test/runners/default.web.js",
          "browser": "chromium"
        }
      }
    }
  }
}
```

If you prefer to keep one mode in a separate file, point the mode directly at that config file:

```json
{
  "modes": {
    "simd": "./as-test.config.simd.json"
  }
}
```

Run a specific mode with:

```bash
npx ast test --mode wasi
```

or

```bash
npx ast test --mode wasi,bindings
```

## Coverage

Coverage is opt-in.

Enable it from the CLI:

```bash
npx ast test --enable coverage
npx ast test --enable coverage --show-coverage
npx ast test --enable coverage --show-coverage=all
```

Or from config:

```json
{
  "coverage": {
    "enabled": true,
    "mode": "project",
    "dependencies": ["json-as"],
    "includeSpecs": false
  }
}
```

Coverage modes:

- `project`
  - covers project files only
  - excludes dependency files by default
- `all`
  - covers project files and dependency files
  - still excludes AssemblyScript stdlib files

If you only want specific dependencies, keep `mode: "project"` and list package names in `dependencies`.
That works for both normal installs and `pnpm` layouts.

`--show-coverage` prints uncovered point details. `--show-coverage=all` and `--verbose` expand nested uncovered gaps instead of collapsing them.

## Fuzzing

Fuzzers usually live in `assembly/__fuzz__/*.fuzz.ts`.

Example:

```ts
import { expect, FuzzSeed, fuzz } from "as-test";

fuzz("bounded integer addition", (left: i32, right: i32): bool => {
  const sum = left + right;
  expect(sum - right).toBe(left);
  return sum >= i32.MIN_VALUE;
}).generate((seed: FuzzSeed, run: (left: i32, right: i32) => bool): void => {
  run(seed.i32({ min: -1000, max: 1000 }), seed.i32({ min: -1000, max: 1000 }));
});
```

Pass a third argument to override the operation count for one target without changing the global fuzz config:

```ts
fuzz(
  "hot path stays stable",
  (): void => {
    expect(1 + 1).toBe(2);
  },
  250,
);
```

Or pass it as the second argument to `.generate(...)`:

```ts
fuzz(
  "ascii strings survive concatenation boundaries",
  (input: string): bool => {
    expect(input.length <= 40).toBe(true);
    return true;
  },
).generate((seed: FuzzSeed, run: (input: string) => bool): void => {
  run(seed.string({ charset: "ascii", min: 0, max: 40 }));
}, 250);
```

You can still override fuzz runs from the CLI when you want to force a different count for the current command:

```bash
npx ast fuzz --runs 500
npx ast fuzz --runs 1.5x
npx ast fuzz --runs +10%
npx ast fuzz --runs +100000
```

If you used `npx ast init` with a fuzzer example, the config is already there. Otherwise, add a `fuzz` block to `as-test.config.json` so `npx ast fuzz` knows what to build:

```json
{
  "fuzz": {
    "input": ["./assembly/__fuzz__/*.fuzz.ts"],
    "target": "bindings"
  }
}
```

`ast fuzz` runs fuzz files across the selected modes, reports one result per file, and keeps the final summary separate from the normal test totals. If you want one combined command, use `ast test --fuzz`.

By default, each fuzz run campaign picks a new random base seed. Pin a seed with `--seed <n>` (or `--fuzz-seed <n>` on `ast test`) when you want deterministic replay.

When a fuzzer fails, `as-test` now prints the exact failing seeds and one-run repro commands such as `ast fuzz ... --seed <seed+n> --runs 1`. Crash records in `.as-test/crashes` also include the captured inputs passed to `run(...)`, which helps when the generator itself has side effects.

Run only fuzzers:

```bash
npx ast fuzz
```

Run one matching fuzz target:

```bash
npx ast fuzz string --fuzzer ascii-strings-survive-concatenation-boundaries
```

Run tests and fuzzers together:

```bash
npx ast test --fuzz
```

Fuzzing is there when you want broader input coverage, but it does not get in the way of the normal test flow. You can start with ordinary specs and add fuzzers later.

This is the general idea throughout the project: write tests once, then choose the runtime that matches how your code actually runs.

## CLI Reference

Invoke as `ast <command>` (alias of `as-test`). Run `ast <command> --help` for the full flag list.

| Command                 | Purpose                                             |
| ----------------------- | --------------------------------------------------- |
| `ast test [selectors]`  | Build the selected specs, run them, print a summary |
| `ast run [selectors]`   | Run already-built specs                             |
| `ast build [selectors]` | Compile specs to wasm without running               |
| `ast fuzz [selectors]`  | Build and run fuzz targets                          |
| `ast init [dir]`        | Scaffold config, a sample spec, and runners         |
| `ast doctor`            | Validate environment, config, and runtime setup     |
| `ast clean`             | Remove build, crash, and log outputs                |

Common flags for `test`/`run`:

| Flag                                                             | Effect                                                     |
| ---------------------------------------------------------------- | ---------------------------------------------------------- |
| `--mode <name[,name...]>`                                        | Run one or more named config modes                         |
| `--parallel`                                                     | Run files through an automatic worker pool                 |
| `--jobs / --build-jobs / --run-jobs <n>`                         | Pin worker counts                                          |
| `--enable / --disable <list>`                                    | Toggle features, e.g. `--enable coverage,try-as`           |
| `--show-coverage[=all]`                                          | Print uncovered points (`=all` expands nested gaps)        |
| `--suite <name[,name...]>`                                       | Filter to matching suite names or slug paths               |
| `--create-snapshots` / `--overwrite-snapshots` / `--no-snapshot` | Snapshot control                                           |
| `--watch`, `-w`                                                  | Re-run on source or spec changes                           |
| `--changed`                                                      | Run only specs whose source or dependencies changed in git |
| `--cache` / `--no-cache`                                         | Toggle the incremental build/run cache                     |
| `--verbose`                                                      | Keep expanded suite/test lines and live updates            |
| `--config <path>`                                                | Use a specific config file                                 |

A selector can be a bare name (`ast test math`), a path or glob, or a folder. Suite slug paths use lowercased, hyphenated segments — `ast run math --suite math/adds-numbers`.

Short aliases: `-m` (`--mode`), `-p` (`--parallel`), `-c` (`--config`), `-e` (`--enable`), plus the built-in `-w` (`--watch`), `-v` (`--version`), and `-h` (`--help`).

## Examples

Runnable example projects live in [examples/](./examples/README.md). They are useful if you want to see complete setups instead of isolated snippets.

## License

This project is distributed under an open source license. Work on this project is done by passion, but if you want to support it financially, you can do so by making a donation to the project's [GitHub Sponsors](https://github.com/sponsors/JairusSW) page.

You can view the full license using the following link: [License](./LICENSE)

## Contact

Please send all issues to [GitHub Issues](https://github.com/JairusSW/json-as/issues) and to converse, please send me an email at [me@jairus.dev](mailto:me@jairus.dev)

- **Email:** Send me inquiries, questions, or requests at [me@jairus.dev](mailto:me@jairus.dev)
- **GitHub:** Visit the official GitHub repository [Here](https://github.com/JairusSW/json-as)
- **Website:** Visit my official website at [jairus.dev](https://jairus.dev/)
- **Discord:** Contact me at [My Discord](https://discord.com/users/600700584038760448) or on the [AssemblyScript Discord Server](https://discord.gg/assemblyscript/)
