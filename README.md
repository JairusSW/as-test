<h5 align="center">
<pre> _____  _____      _____  _____  _____  _____ 
|  _  ||   __| ___|_   _||   __||   __||_   _|
|     ||__   ||___| | |  |   __||__   |  | |  
|__|__||_____|      |_|  |_____||_____|  |_|  
v0.3.1
</pre>
</h5>

## Installation

To get started, install the package from NPM or GitHub

`npm i as-test --save-dev`

You'll also need to install `visitor-as`

`npm i visitor-as --save-dev`

View the docs: https://docs.jairus.dev/as-test

## Usage

You can setup the configuration files using

```bash
as-test init
```

Note: You can use either `ast` or `as-test` in the terminal.

Next, take a look at the generated test file

`assembly/__tests__/example.spec.ts`

```js
import {
    describe,
    expect,
    test,
    beforeAll,
    afterAll,
    mockFn,
    log,
    run,
    it
} from "as-test";

beforeAll(() => {
    log("Setting up test environment...");
});

afterAll(() => {
    log("Tearing down test environment...");
});

// Mock/override the function console.log
mockFn<void>("console.log", (data: string): void => {
    console.log("[MOCKED]: " + data + "\n");
});

describe("Should sleep", () => {
    test("1ms", () => {
        const start = Date.now();
        sleep(1);
        expect(Date.now() - start).toBeGreaterOrEqualTo(1);
    });
    test("10ms", () => {
        const start = Date.now();
        sleep(10);
        expect(Date.now() - start).toBeGreaterOrEqualTo(10);
    });
    test("1s", () => {
        const start = Date.now();
        sleep(1000);
        expect(Date.now() - start).toBeGreaterOrEqualTo(1000);
    });
    test("5s", () => {
        const start = Date.now();
        log("Sleeping...");
        sleep(5000);
        log("Done!");
        expect(Date.now() - start).toBeGreaterOrEqualTo(5000);
    });
});

describe("Math operations", () => {
    test("Addition", () => {
        expect(1 + 2).toBe(3);
    });

    test("Subtraction", () => {
        expect(1 - 2).toBe(-1);
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

let myArray: i32[] = [1, 2, 3];

describe("Array manipulation", () => {
    test("Array length", () => {
        expect(myArray).toHaveLength(3);
    });

    test("Array inclusion", () => {
        expect(myArray).toContain(2);
    });

    it("should be empty", () => { });
});

run();

function sleep(ms: i64): void {
    const target = Date.now() + ms;
    while (target > Date.now()) { }
}
```

Build and run it using as-test

```bash
npm run test
```

<img src="https://raw.githubusercontent.com/JairusSW/as-test/main/assets/img/screenshot.png">

<h6>

## Running

To add `as-test` to your CI/CD workflow, check out [The provided example](https://github.com/JairusSW/as-test/blob/main/.github/workflows/nodejs.yml)

If you use this project in your codebase, consider dropping a [⭐ HERE](https://github.com/JairusSW/as-test). I would really appreciate it!

## Notes

This library is in the EARLY STAGES OF DEVELOPMENT!
If you want a feature, drop an issue (and again, maybe a star). I'll likely add it in less than 7 days.

## Issues

Please submit an issue to https://github.com/JairusSW/as-test/issues if you find anything wrong with this library
