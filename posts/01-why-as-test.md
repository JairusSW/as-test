# Why I Built as-test

AssemblyScript testing has had a weird problem for a while.

You can usually get something running in Node.js, but that does not necessarily tell you much about how your code behaves in the environment where it will actually run. If your real target is WASI, or some custom host, or a bindings-based runtime with a specific import surface, then a lot of the confidence from your tests is borrowed confidence. It feels good, but it is not always real.

That gap is what pushed me toward building `as-test`.

## The Problem

Most test setups make one runtime the center of the world.

That can be fine when your production environment is also that runtime. But with AssemblyScript, that is often not the case. You might be:

- compiling for WASI
- running in Wasmtime
- using raw bindings in Node
- shipping into a browser worker
- relying on a narrow host import contract

In those cases, it is easy to end up with tests that are technically passing while still being disconnected from the environment that matters.

You start writing wrappers. Then mocks for those wrappers. Then more wrappers so the mocks are easier to manage. At some point, the test harness stops feeling like a thin tool and starts feeling like a parallel application.

That is not a great place to be.

## What I Wanted Instead

I wanted a test runner that kept the center of gravity closer to the compiled artifact and the runtime that artifact actually uses.

The idea was simple:

- build AssemblyScript normally
- run the generated wasm in the runtime you care about
- keep the test API familiar
- only mock what actually needs to be mocked

That is the core of `as-test`.

It is not trying to turn AssemblyScript into JavaScript testing with slightly different syntax. It is trying to let AssemblyScript projects test themselves on terms that match how they are actually deployed.

## The Main Bet

The main bet behind `as-test` is that runtime differences matter more than many projects admit.

They matter in:

- import behavior
- host function availability
- wasi assumptions
- browser constraints
- bindings setup
- failure modes and serialization paths

A lot of bugs only appear once your code is sitting inside the real runtime contract.

That is why `as-test` focuses on:

- multiple runtime modes
- minimal mocking
- snapshot support
- fuzzing
- reporters and coverage that still fit normal workflows

The goal is not complexity for its own sake. The goal is to make runtime-aware testing feel normal.

## What I Like About the Result

The part I like most is that the happy path stays small.

You can still write a simple spec like this:

```ts
import { describe, expect, test } from "as-test";

describe("math", () => {
  test("adds numbers", () => {
    expect(1 + 2).toBe(3);
  });
});
```

And run it with:

```bash
npx ast test
```

That matters. If the runtime-aware path is too heavy, people will not use it.

So the project tries to keep the first step obvious, then let you grow into:

- different runtimes
- import mocking
- snapshots
- fuzzing

without switching tools halfway through.

## Where I Think It Fits

I think `as-test` is most useful for people who care about one or more of these:

- testing wasm in a real-ish runtime instead of only in Node
- keeping mocking narrow and intentional
- running the same project in more than one mode
- fuzzing AssemblyScript code without bolting on a completely separate workflow

If your project is tiny and pure and runtime differences do not matter, you may not need much of this.

But once the runtime starts to matter, it matters a lot.

That is the niche `as-test` is trying to serve.
