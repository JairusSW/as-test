# Fuzzing in AssemblyScript Without Leaving Your Test Workflow

There is a point where example-based tests stop being enough.

You can write a clean set of unit tests and still miss the weird input that breaks parsing, trips an assumption, or exposes some ugly runtime behavior. That is where fuzzing starts to earn its keep.

What I wanted from fuzzing in `as-test` was not “a separate research project.” I wanted something that fit the existing workflow well enough that people would actually use it.

## What Fuzzing Is Good At

Fuzzing is especially good at:

- unexpected input combinations
- malformed strings and buffers
- parser edge cases
- property-style checks
- asserting that code keeps its invariants across a large input space

It is not a replacement for normal tests.

It is a second layer.

Your normal specs say, “here are important examples.”

Your fuzzers say, “now push on this from many angles and see what breaks.”

## The as-test Shape

A simple fuzzer in `as-test` looks like this:

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

That keeps the authoring model close to the rest of the library:

- define a named target
- make assertions inside it
- optionally return a boolean property result
- generate inputs with a seed helper

## Why This Matters

A lot of fuzzing tools are powerful but awkward to adopt in normal application code.

They tend to live off to the side:

- separate targets
- separate runners
- separate habits
- separate failure/repro workflow

That is fine when a team is already deep into fuzzing.

But if you want ordinary AssemblyScript developers to actually use fuzzing, the API has to feel like it belongs next to their tests.

That is what I like about the current shape.

You can run:

```bash
npx ast fuzz
```

or:

```bash
npx ast test --fuzz
```

So fuzzing can be a focused local loop or part of a broader verification pass.

## What Makes It Practical

For fuzzing to be useful day to day, a few things matter more than people sometimes admit:

- deterministic seeds
- clear failure output
- repro commands
- keeping it close to normal test authoring

If a fuzzer fails but reproducing the failure is annoying, people stop trusting the feature.

If the API is too foreign, they never write the fuzzer in the first place.

So the value is not just in “we support fuzzing.” The value is in making it ordinary enough to become part of the project’s normal feedback loop.

## Where I Think It Fits Best

I think fuzzing pays off quickly for:

- parsers
- string processing
- byte-oriented code
- boundary-heavy logic
- anything with a lot of “this should never happen” assumptions

You do not need to fuzz every function in the project.

You just need to fuzz the places where weird inputs are likely to teach you something.

That is usually enough.
