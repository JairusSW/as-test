<h5 align="center">
<pre> _____  _____      _____  _____  _____  _____ 
|  _  ||   __| ___|_   _||   __||   __||_   _|
|     ||__   ||___| | |  |   __||__   |  | |  
|__|__||_____|      |_|  |_____||_____|  |_|  
v0.0.5
</pre>
</h5>

## Installation

```bash
npm install as-test
```

## Usage

```js
import {
  describe,
  expect,
  test,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  log,
  run
} from "as-test";

// Shared setup for all tests (executed once before all tests)
beforeAll(() => {
  log("Setting up test environment...");
});

// Shared teardown for all tests (executed once after all tests)
afterAll(() => {
  log("Tearing down test environment...");
});

describe("Math operations", () => {
  // Setup before each test in this group (optional)
  beforeEach(() => {
    log("Initializing test...");
  });

  // Teardown after each test in this group (optional)
  afterEach(() => {
    log("Cleaning up after test...");
  });

  test("Addition", () => {
    expect(1 + 2).toBe(3);
  });

  test("Comparison", () => {
    expect(5).toBeGreaterThan(3);
    expect(2).toBeLessThan(4);
  });

  test("Type checking", () => {
    expect("hello").toBeString();
    expect(true).toBeBoolean();
    expect(10.5).toBeNumber();
  });
});

let myArray: i32[] = [];

describe("Array manipulation", () => {
  beforeAll(() => {
    myArray = [1, 2, 3];
  });

  test("Array length", () => {
    expect(myArray).toHaveLength(3);
  });

  test("Array inclusion", () => {
    expect(myArray).toContain(2);
  });
});

run({
  log: false
});
```

<h6>
<pre> _____  _____      _____  _____  _____  _____ 
|  _  ||   __| ___|_   _||   __||   __||_   _|
|     ||__   ||___| | |  |   __||__   |  | |  
|__|__||_____|      |_|  |_____||_____|  |_|  

-----------------------------------------

 [PASS]  Math operations

 [PASS]  Array manipulation

 [PASS]  Addition

 [PASS]  Comparison

 [PASS]  Type checking

 [PASS]  Array length

 [PASS]  Array inclusion

-----------------------------------------

Test Suites: 0 failed, 2 total
Tests:       0 failed, 8 total
Snapshots:   0 total
Time:        101.812μs
</pre>
</h6>

## Running

You can run as-test *anywhere* that WASI is supported! I've yet to add support for bindings, but all it needs is access to the terminal.

To add WASI support, install it with

```
npm install @assemblyscript/wasi-shim
```

Add the following scripts to your `package.json` where NAME-HERE is your test file.
You can swap out `wasmtime` with [Node.js](https://nodejs.org/), [Wasmer](https://wasmer.io/), [Wasm3](https://github.com/wasm3/wasm3), or any WASI-supporting runtime

```json
"scripts": {
  "test": "wasmtime ./build/NAME.spec.wasm",
  "pretest": "asc asc NAME.spec.ts -o build/NAME.spec.wasm --bindings esm --config ./node_modules/@assemblyscript/wasi-shim/asconfig.json"
}
```

And finally, run it with:

```bash
npm run test
```

To add `as-test` to your CI/CD workflow, check out [The provided example](https://github.com/JairusSW/as-test/blob/main/.github/workflows/nodejs.yml)

If you use this project in your codebase, consider dropping a [⭐ HERE](https://github.com/JairusSW/as-test). I would really appreciate it!

## Notes

This library is in the EARLY STAGES OF DEVELOPMENT!
If you want a feature, drop an issue (and again, maybe a star). I'll likely add it in less than 7 days.

## Contact

Contact me at:

Email: `me@jairus.dev`

GitHub: `JairusSW`

Discord: `jairussw`

## Issues

Please submit an issue to https://github.com/JairusSW/as-test/issues if you find anything wrong with this library