# Mock Less, Snapshot What Matters

Mocking is useful, but it gets abused easily.

In a lot of test suites, mocking starts as a small convenience and ends as the whole architecture. Once that happens, your tests are often validating a world you invented for the test runner rather than the real one your code actually lives in.

`as-test` takes a narrower view.

The idea is:

- run against the real runtime when possible
- mock the specific thing that is hard or noisy
- snapshot outputs when that is clearer than dozens of tiny assertions

That combination is practical without turning the suite into theater.

## Where Mocking Helps

Mocking is most useful when a dependency is:

- outside your control
- expensive to reproduce
- non-deterministic
- awkward to trigger in a test

For example, a host import that reads time, environment data, or external state is a good candidate.

What you usually do not want is to rebuild your entire runtime as a pile of mocks just so one function is easier to test.

## Local Function Mocking

For local functions, `mockFn` is the simplest option.

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

That does not try to fake the whole world. It just replaces the one thing you care about.

## Import Mocking

Import mocking matters when your AssemblyScript code calls host-provided functions.

That is one of the places runtime-aware testing gets tricky, because host imports are real boundaries.

When you need to control one of those boundaries, `mockImport` and `unmockImport` let you override specific imports without changing the overall structure of your test suite.

The important part is not the API surface. It is the discipline: mock the edge, not the whole program.

## When Snapshots Are Better

Snapshots shine when the output itself is the thing you care about.

That includes:

- generated text
- serialized output
- formatted reports
- output from mocked imports
- results that are too large to check one field at a time

A snapshot keeps the test readable while still letting you lock the behavior down.

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

Then initialize snapshots once:

```bash
npx ast test --update-snapshots
```

After that, a normal test run verifies the output.

## The Real Win

The real win is not “mocking support” or “snapshot support” as isolated features.

It is that both of them fit into a workflow where the runtime is still the main thing, not the mock framework.

That keeps the suite grounded.

And grounded suites tend to age better.
