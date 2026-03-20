# Getting Started With as-test

If you are new to `as-test`, the good news is that the first step is small.

You do not need to learn every runtime mode, every reporter option, or every advanced feature before the library is useful.

The easiest way to think about it is:

- start with one test
- run it
- only add more structure when your project needs it

## Start With the Initializer

The quickest way in is:

```bash
npx as-test init
```

That gives you:

- an `as-test.config.json`
- an example spec
- default runner files
- optionally a fuzz example

If you already have a project set up and only want the package:

```bash
npm install --save-dev as-test
```

## Write a Small Test

Put a spec in `assembly/__tests__/math.spec.ts`:

```ts
import { describe, expect, test } from "as-test";

describe("math", () => {
  test("adds numbers", () => {
    expect(1 + 2).toBe(3);
  });
});
```

Run it with:

```bash
npx ast test
```

That is the core loop.

## Add Only What You Need

Once the basic loop is working, you can branch out gradually.

If your code depends on a function you want to control in tests, add mocking.

If your output is easier to compare as a whole, add snapshots.

If your input space is bigger than a few hand-written examples, add fuzzers.

If runtime differences matter, define modes and run the same tests under more than one runtime.

The point is not to switch into “advanced mode.” The point is to keep adding pressure only where the project benefits from it.

## A Healthy Upgrade Path

One of the easiest ways to make a testing tool feel heavy is to require the whole system up front.

`as-test` works better when you treat it like this:

1. write a spec
2. get green
3. add one runtime-specific concern
4. add one realism feature where it helps

That could look like:

- first a simple matcher-based spec
- then a snapshot
- then a mocked import
- then a second runtime mode
- then a fuzzer for one risky area

That is a much more natural progression than trying to front-load every feature.

## The Main Idea

The main thing to understand about `as-test` is that it is trying to keep AssemblyScript testing close to the actual runtime story.

That is the thread running through everything:

- the basic specs
- the runtime modes
- mocking
- snapshots
- fuzzing

It is all aimed at one result: making tests useful without drifting too far from the code that really ships.
