import { rainbow } from "as-rainbow";
import { Suite, SuiteKind } from "./src/suite";
import { Expectation } from "./src/expectation";
import { stringify } from "as-console/stringify";
import { __COVER, __HASHES, __POINTS } from "as-test/assembly/coverage";
import { JSON } from "json-as";
import { Report, SuiteReport, TestReport, Time } from "../reporters/report";
import { term } from "./util/term";

/**
 * Enumeration representing the verdict of a test case.
 */
export type Verdict = string;
export namespace Verdict {
  export const None = "none";
  export const Ok = "ok";
  export const Fail = "fail";
}

let entrySuites: Suite[] = [];

// @ts-ignore
const FILE = isDefined(ENTRY_FILE) ? ENTRY_FILE : "unknown";
// Globals
@global let suites: Suite[] = [];

@global let depth: i32 = -1;

@global let current_suite: Suite | null = null;

let before_all_callback: (() => void) | null = null;
let after_all_callback: (() => void) | null = null;

export let before_each_callback: (() => void) | null = null;
export let after_each_callback: (() => void) | null = null;
let __test_options!: RunOptions;

/**
 * Creates a test group containing multiple test cases.
 *
 * @param {string} description - The name of the test group
 * @param {() => void} callback - The block containing the test cases for this group
 *
 * @example
 * ```ts
 * describe("my test suite", () => {
 *   expect(1 + 3).toBe(4);
 *   // More tests here
 * });
 * ```
 */
export function describe(description: string, callback: () => void): void {
  const suite = new Suite(description, callback, SuiteKind.Describe);

  if (depth >= 0) {
    const _suite = suites[depth];
    if (_suite.depth == depth) {
      _suite.addSuite(suite);
    } else {
      suite.depth = ++depth;
      suites.push(suite);
    }
  } else {
    entrySuites.push(suite);
    suites.push(suite);
  }
}

/**
 * Creates a test group containing multiple test cases
 *
 * @param {string} description - The name of the test group
 * @param {() => void} callback - The block containing the test cases for this group
 *
 * @example
 *
 * ```ts
 * test("1 + 3 = 4", () => {
 *  expect(1 + 3).toBe(4);
 * });
 * ```
 */
export function test(description: string, callback: () => void): void {
  const suite = new Suite(description, callback, SuiteKind.Test);

  if (depth >= 0) {
    const _suite = suites[depth];
    if (_suite.depth == depth) {
      _suite.addSuite(suite);
    } else {
      suite.depth = ++depth;
      suites.push(suite);
    }
  } else {
    entrySuites.push(suite);
    suites.push(suite);
  }
}

/**
 * Creates a test group containing multiple test cases
 *
 * @param {string} description - The name of the test group
 * @param {() => void} callback - The block containing the test cases for this group
 *
 * @example
 *
 * ```ts
 * it("should perform additions", () => {
 *  expect(1 + 3).toBe(4);
 * });
 * ```
 */
export function it(description: string, callback: () => void): void {
  const suite = new Suite(description, callback, SuiteKind.It);

  if (depth >= 0) {
    const _suite = suites[depth];
    if (_suite.depth == depth) {
      _suite.addSuite(suite);
    } else {
      suite.depth = ++depth;
      suites.push(suite);
    }
  } else {
    entrySuites.push(suite);
    suites.push(suite);
  }
}

/**
 * Creates an expectation object for making assertions within a test case.
 *
 * Use this function to chain assertions about a specific value.
 * The returned expectation object provides various methods for testing
 * different properties and conditions of the value.
 *
 * @param {T} value - The value to be asserted against.
 * @returns {Expectation<T>} - The expectation object for chaining assertions.
 *
 * @example
 * ```ts
 * test("number comparison", () => {
 *   expect(1 + 2).toBe(3);
 *   expect(5).toBeGreaterThan(3);
 * });
 * ```
 */
export function expect<T>(value: T): Expectation<T> {
  const test = new Expectation<T>(value);

  if (current_suite) {
    current_suite!.addExpectation(test);
  }

  return test;
}

/**
 * Formats and prints content to the terminal
 * Can be disabled like so:
 *
 * ```js
 * // ...
 *
 * run({ log: false });
 * ```
 *
 * @param {T} data - The data to format and print
 */
export function log<T>(data: T): void {
  if (!__test_options.log) return;
  const formatted = stringify(data);
  if (formatted) {
    const lines = formatted.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = unchecked(lines[i]);
      console.log("  " + rainbow.bgYellow(" LOG ") + " " + line);
    }
    console.log("");
  }
}

/**
 * Registers a callback function to be executed before each test group is run.
 *
 * @param {() => void} callback - The function to be executed before each test group.
 */
export function beforeAll(callback: () => void): void {
  before_all_callback = callback;
}

/**
 * Registers a callback function to be executed after each test group is run.
 *
 * @param {() => void} callback - The function to be executed after each test group.
 */
export function afterAll(callback: () => void): void {
  after_all_callback = callback;
}

/**
 * Registers a callback function to be executed before each test case is run.
 *
 * @param {() => void} callback - The function to be executed before each test case.
 */
export function beforeEach(callback: () => void): void {
  before_each_callback = callback;
}

/**
 * Registers a callback function to be executed after each test case is run.
 *
 * @param {() => void} callback - The function to be executed after each test case.
 */
export function afterEach(callback: () => void): void {
  after_each_callback = callback;
}

/**
 * Overrides all references to an existing function in local scope to instead point to new function
 * @param {string} fn - name of function to override
 * @param {() => returnType} callback - the function to substitute it with
 */
export function mockFn<returnType>(
  fn: string,
  callback: (...args: any[]) => returnType,
): void { }

/**
 * Unmock all references to an existing function to instead point to the original function
 * @param {string} fn - name of function to override
 */
export function unmockFn(fn: string): void { }

/**
 * Re-mock all references to an existing function to instead point to the declared function
 * @param {string} fn - name of function to override
 */
export function remockFn(fn: string): void { }

/**
 * Class defining options that can be passed to the `run` function.
 *
 * Currently, it offers a single option:
 *
 * - `log` (boolean, default: true): Controls whether enable the log() function
 **/
class RunOptions {
  log: boolean = true;
}

/**
 * Runs all the test suites defined within the current test scope.
 *
 * This function executes all the test cases you've defined in your test suites.
 * It iterates through each suite, runs the tests within the suite, and tracks results.
 * Finally, it prints a colorful summary of the test execution.
 *
 * @param {RunOptions} [options] - Optional options for running tests.
 *
 * @example
 * ```javascript
 * describe("Math operations", () => {
 *   test("Addition", () => {
 *     expect(1 + 2).toBe(3);
 *   });
 *   // ... other tests
 * });
 *
 * run(); // Executes all tests in the "Math operations" suite
 * ```
 */
export function run(options: RunOptions = new RunOptions()): void {
  __test_options = options;
  term.write("\n");
  const time = new Time();
  const fileLn = term.write(`${rainbow.bgCyanBright(" FILE ")} ${rainbow.dimMk(FILE)}\n`);
  term.write("\n");
  time.start = performance.now();
  for (let i = 0; i < entrySuites.length; i++) {
    // @ts-ignore
    const suite = unchecked(entrySuites[i]);
    suites = [suite];

    current_suite = suite;
    depth = -1;
    current_suite = null;

    const suiteLn = term.write(`  ${rainbow.bgBlackBright(" ... ")} ${rainbow.dimMk(suite.description)}\n`);
    term.write("\n");
    suite.run();

    suites = [];
    depth = -1;
    current_suite = null;

    let suiteNone = true;
    for (let ii = 0; ii < suite.suites.length; ii++) {
      const _suite = unchecked(suite.suites[ii]);
      if (_suite.verdict == Verdict.Fail) {
        suite.verdict = Verdict.Fail;
        suiteNone = false;
      } else if (_suite.verdict == Verdict.Ok) {
        suiteNone = false;
      }
    }

    for (let iii = 0; iii < suite.tests.length; iii++) {
      const _test = unchecked(suite.tests[iii]);
      if (_test.verdict == Verdict.Fail) {
        suite.verdict = Verdict.Fail;
      }
    }

    if (!suiteNone && suite.tests.length) {
      suite.verdict = Verdict.Ok;
    }

    if (suite.verdict == Verdict.Ok) {
      suiteLn.edit(`  ${rainbow.bgGreenBright(" PASS ")} ${rainbow.dimMk(suite.description)} ${rainbow.dimMk(suite.time.format())}\n`);
    }
  }
  time.end = performance.now();
  fileLn.edit(`${rainbow.bgCyanBright(" FILE ")} ${rainbow.dimMk(FILE)} ${rainbow.dimMk(time.format())}`);
}

export function getDepth(): string {
  if (depth < 0) return "";
  return "  ".repeat(depth);
}