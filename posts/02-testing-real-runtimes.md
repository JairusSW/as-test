# Test the Runtime You Actually Care About

One of the easiest traps in AssemblyScript testing is treating Node.js as the default truth.

Node is useful. It is convenient. It is where a lot of tooling naturally lives.

But if your production target is not really “Node running helper code around wasm,” then a Node-only test loop can quietly train you to trust the wrong thing.

That is why one of the best parts of `as-test` is not a matcher or a reporter. It is the fact that you can define runtime modes and run the same project across them.

## Why Runtime-Specific Testing Matters

A wasm module does not run in a vacuum.

It depends on:

- how imports are provided
- how startup is handled
- whether you are in WASI or bindings mode
- what host environment exists
- how logs, traps, and output move back to the runner

Those details are exactly where a lot of “works on my machine” bugs come from.

If your code is intended for WASI, then testing it in WASI should not be a weird edge case. It should be part of the normal workflow.

## A Better Default

With `as-test`, you can define modes in `as-test.config.json` and keep the differences explicit.

For example:

```json
{
  "modes": {
    "node-bindings": {
      "buildOptions": {
        "target": "bindings"
      },
      "runOptions": {
        "runtime": {
          "cmd": "node ./.as-test/runners/default.bindings.js <file>"
        }
      }
    },
    "node-wasi": {
      "buildOptions": {
        "target": "wasi"
      },
      "runOptions": {
        "runtime": {
          "cmd": "node ./.as-test/runners/default.wasi.js <file>"
        }
      }
    },
    "wasmtime-wasi": {
      "buildOptions": {
        "target": "wasi"
      },
      "runOptions": {
        "runtime": {
          "cmd": "wasmtime run --dir . <file>"
        }
      }
    }
  }
}
```

Then you can run:

```bash
npx ast test --mode node-bindings,node-wasi,wasmtime-wasi
```

That is a much more honest signal than pretending those environments are interchangeable.

## This Is Not About Making Everything Harder

There is a temptation to look at multiple modes and think, “this is more setup than I want.”

That is fair, but the point is not to make every project do everything all at once.

The point is to make runtime-aware testing available before you need it badly.

A good progression looks like this:

1. Start with one mode.
2. Get your basic tests in place.
3. Add a second mode when the runtime contract starts to matter.
4. Promote multi-mode runs into CI when they prove valuable.

That is a lot easier than trying to retrofit runtime realism later.

## What You Catch Earlier

Running tests across real modes helps catch issues like:

- missing imports
- different host behavior
- accidental reliance on one runner
- output/reporting edge cases
- assumptions about browser or WASI availability

These are not glamorous bugs, but they are exactly the kind that waste time because they show up late.

## The Payoff

The payoff is simple: your test suite starts reflecting the shape of your real deployment.

That does not make the suite perfect. Nothing does.

But it does make it more honest.

And for AssemblyScript, honesty about the runtime is a big deal.
