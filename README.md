<h1 align="center"><pre>╔═╗ ╔═╗    ╔═╗ ╔═╗ ╔═╗ ╔═╗
╠═╣ ╚═╗ ══  ║  ╠═  ╚═╗  ║ 
╩ ╩ ╚═╝     ╩  ╚═╝ ╚═╝  ╩ </pre></h1>

<details>
<summary>Table of Contents</summary>

- [Why as-test](#why-as-test)
- [Installation](#installation)
- [Project Layout](#project-layout)
- [Writing Tests](#writing-tests)
- [Mocking](#mocking)
- [Snapshots](#snapshots)
- [Fuzzing](#fuzzing)
- [Runtimes](#runtimes)
- [Examples](#examples)
- [License](#license)

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
- Integrated fuzzing support

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

## Project Layout

By default, `as-test` looks for:

- tests in `assembly/__tests__`
- fuzzers in `assembly/__fuzz__`
- config in `as-test.config.json`

Generated files go into `.as-test/`.

## Writing Tests

Tests usually live in `assembly/__tests__/*.spec.ts`.

Example:

```ts
import { describe, expect, test } from "as-test";

describe("math", () => {
  test("adds numbers", () => {
    expect(1 + 2).toBe(3);
  });
});
```

Run everything:

```bash
npx ast test
```

Run one matching file:

```bash
npx ast test math
```

You do not need to learn every CLI flag to get started. Most projects can begin with `npx ast test`, then add more configuration only when they need it.

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
npx ast test --update-snapshots
```

After that, a normal `npx ast test` will verify it.

## Fuzzing

Fuzzers usually live in `assembly/__fuzz__/*.fuzz.ts`.

Example:

```ts
import { expect, fuzz, FuzzSeed } from "as-test";

fuzz("bounded integer addition", (left: i32, right: i32): bool => {
  const sum = left + right;
  expect(sum - right).toBe(left);
  return sum >= i32.MIN_VALUE;
}).generate((seed: FuzzSeed, run: (left: i32, right: i32) => bool): void => {
  run(
    seed.i32({ min: -1000, max: 1000 }),
    seed.i32({ min: -1000, max: 1000 }),
  );
});
```

If you used `npx as-test init` with a fuzzer example, the config is already there. Otherwise, add a `fuzz` block to `as-test.config.json` so `npx ast fuzz` knows what to build:

```json
{
  "fuzz": {
    "input": ["./assembly/__fuzz__/*.fuzz.ts"],
    "target": "bindings"
  }
}
```

Run only fuzzers:

```bash
npx ast fuzz
```

Run tests and fuzzers together:

```bash
npx ast test --fuzz
```

Fuzzing is there when you want broader input coverage, but it does not get in the way of the normal test flow. You can start with ordinary specs and add fuzzers later.

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
      "cmd": "node ./.as-test/runners/default.wasi.js <file>"
    }
  }
}
```

Then run your tests normally:

```bash
npx ast test
```

If you want to keep more than one runtime around, use modes:

```json
{
  "input": ["./assembly/__tests__/*.spec.ts"],
  "modes": {
    "wasi": {
      "buildOptions": {
        "target": "wasi"
      },
      "runOptions": {
        "runtime": {
          "cmd": "node ./.as-test/runners/default.wasi.js <file>"
        }
      }
    },
    "bindings": {
      "buildOptions": {
        "target": "bindings"
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

Run a specific mode with:

```bash
npx ast test --mode wasi
```

or

```bash
npx ast test --mode wasi,bindings
```

This is the general idea throughout the project: write tests once, then choose the runtime that matches how your code actually runs.

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
