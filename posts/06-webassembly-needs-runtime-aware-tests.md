# WebAssembly Testing Needs to Be Runtime-Aware

One of the easiest mistakes to make with WebAssembly is to talk about testing “the wasm” as if the wasm were the whole program.

It is not.

A wasm module always runs inside a host, and the host is not a neutral container. It decides what imports exist, how startup works, what capabilities are available, how IO is handled, how errors surface, and what shape the boundary between guest and host actually has.

That means the runtime is part of the contract.

And yet a lot of wasm testing still quietly assumes that if something passes in one convenient environment, that is probably good enough.

Sometimes it is.

But very often, it is not.

## “It Passes in Node” Is Not the End of the Story

Node is a good place to test wasm.

It is fast to script, easy to automate, and familiar to most people doing tooling work. None of that is the problem.

The problem starts when a Node run stops being one useful signal and starts being treated as the signal.

If your real target is:

- WASI
- Wasmtime
- a browser
- raw bindings
- a custom host with a narrow import surface

then “it passes in Node” is only telling you that one version of the runtime story is healthy.

That can still be valuable. It just is not complete.

This is where a lot of false confidence comes from in wasm projects. The suite is green, but the thing you actually ship lives in a different host with a meaningfully different contract.

## The Bugs Are Often Contract Bugs, Not Logic Bugs

When people think about tests failing across runtimes, they often imagine big dramatic differences.

In reality, the failures are usually smaller and more annoying than that.

Things like:

- an import exists in one environment but not another
- a host function returns something slightly different than the harness assumed
- startup happens in a different order
- a browser worker path behaves differently from a CLI runner
- WASI assumptions leak into a bindings path
- a reporting or serialization path breaks only in one runner

These are not exotic edge cases. They are exactly the kinds of bugs you should expect once code moves between real runtimes.

That is why runtime-aware testing matters so much more for WebAssembly than many teams first assume.

## Mocks Help, but They Do Not Replace the Runtime

A common answer to all of this is, “just mock the environment.”

That answer is partly right.

Mocks absolutely help when:

- one boundary is inconvenient
- one import needs to be controlled
- one edge case is hard to trigger naturally

But mocking the runtime is not the same thing as validating the runtime.

There is a big difference between:

- mocking a specific host call so a test can stay focused

and:

- replacing the entire environment with a fake world that only exists to make the suite easy to run

Once the second thing happens, the tests may still be useful, but they are no longer telling you much about the actual deployment contract. They are mostly proving that your test harness is internally consistent.

That is a much weaker result.

## WebAssembly Needs Better Questions

A better question than “can I test this wasm module?” is:

“Can I test this wasm module in the environments that actually matter?”

That question changes the shape of the tooling you want.

Now you care about:

- running the same project in more than one mode
- keeping host differences explicit
- avoiding huge fake-runtime abstractions
- making the runtime choice part of the normal workflow instead of an afterthought

That is a much healthier model for wasm testing.

## This Is the Problem as-test Is Trying to Solve

The idea behind `as-test` is not complicated.

It is just opinionated:

- compile the AssemblyScript normally
- run the actual artifact
- let the project define multiple runtime modes
- keep mocking narrow instead of turning it into the whole testing strategy

That makes it possible to say:

- run these specs in Node bindings
- run them again in Node WASI
- run them again in Wasmtime
- run a web-targeted build in the browser runner

That is a much more honest picture of whether the code really works.

## Why This Only Gets More Important

A tiny pure wasm module can go a surprisingly long time before runtime differences really bite.

But as soon as a project grows into:

- imports
- IO
- configuration
- logging
- snapshots
- browser execution
- fuzzing

the surrounding environment starts shaping the failures you see.

At that point, runtime-aware testing stops being a fancy extra and starts becoming part of doing the job properly.

## The Main Point

The runtime is not a side detail in WebAssembly.

It is part of the software.

If your tests pretend otherwise, they can still be useful, but they will only be useful up to the point where the host contract starts to matter.

And for real wasm projects, that point tends to arrive sooner than people expect.

That is the gap `as-test` is trying to close.
