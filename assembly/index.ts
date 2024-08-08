import { rainbow } from "as-rainbow";
import { Suite } from "./src/suite";
import { Expectation } from "./src/expectation";
import { stringify } from "as-console/stringify";
import { __COVER, __HASHES, __POINTS } from "as-test/assembly/coverage";
import { JSON } from "json-as";
import { term } from "./util/term";
import { Log } from "./src/log";

let entrySuites: Suite[] = [];

// @ts-ignore
const FILE = isDefined(ENTRY_FILE) ? ENTRY_FILE : "unknown";
// Globals
// @ts-ignore
@global let __mock_global: Map<string, u32> = new Map<string, u32>();
// @ts-ignore
@global let __mock_import: Map<string, u32> = new Map<string, u32>();
// @ts-ignore
@global let suites: Suite[] = [];
// @ts-ignore
@global let depth: i32 = -1;
// @ts-ignore
@global let current_suite: Suite | null = null;
// @ts-ignore
let before_all_callback: (() => void) | null = null;
// @ts-ignore
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
  const suite = new Suite(description, callback, "describe");

  if (depth >= 0) {
    const _suite = suites[depth];
    if (_suite.depth == depth) {
      _suite.addSuite(suite);
    } else {
      suite.depth = ++depth;
      suites.push(suite);
    }
  } else {
    suite.file = FILE;
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
  const suite = new Suite(description, callback, "test");

  if (depth >= 0) {
    const _suite = suites[depth];
    if (_suite.depth == depth) {
      _suite.addSuite(suite);
    } else {
      suite.depth = ++depth;
      suites.push(suite);
    }
  } else {
    suite.file = FILE;
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
  const suite = new Suite(description, callback, "it");

  if (depth >= 0) {
    const _suite = suites[depth];
    if (_suite.depth == depth) {
      _suite.addSuite(suite);
    } else {
      suite.depth = ++depth;
      suites.push(suite);
    }
  } else {
    suite.file = FILE;
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
      if (current_suite) {
        current_suite!.addLog(new Log(line));
      }
    }
    term.write("\n");
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
 * Replace all references to an existing function to new function
 * @param {Function} oldFn - name of function to mock
 * @param {Function} newFn - the function to substitute it with
 */
export function mockFn(oldFn: Function, newFn: Function): void {}

export function mockImport(oldFn: string, newFn: () => string): void {
  __mock_import.set(oldFn, newFn.index);
  // mocks.set(oldFn, new MockFn(oldFn, newFn).enable());
}

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
  // const buf = new ArrayBuffer(20);
  // const bytes = process.stdin.read(buf);
  // const stdinLn = term.write(String.UTF8.decodeUnsafe(changetype<usize>(buf), bytes) + "\n");
  __test_options = options;
  const time = new Time();
  const fileLn = term.write(
    `${rainbow.bgCyanBright(" FILE ")} ${rainbow.dimMk(FILE)}\n`,
  );
  term.write("\n");
  time.start = performance.now();
  for (let i = 0; i < entrySuites.length; i++) {
    // @ts-ignore
    const suite = unchecked(entrySuites[i]);
    suites = [suite];

    current_suite = suite;
    depth = -1;
    current_suite = null;

    suite.run();

    suites = [];
    depth = -1;
    current_suite = null;
  }
  time.end = performance.now();
  fileLn.edit(
    `${rainbow.bgCyanBright(" FILE ")} ${rainbow.dimMk(FILE)} ${rainbow.dimMk(time.format())}`,
  );
  const reportText = JSON.stringify(entrySuites);
  const chunk_size = 48;
  let chunks = reportText.length / chunk_size;
  let index = 0;
  term.write("\x1B[8m\n").clear(); // Hide text (so that the cursor doesn't flash for a moment)
  while (chunks--) {
    term
      .write(
        "READ_LINE" +
          reportText.slice(index, (index += chunk_size)) +
          "END_LINE\n",
      )
      .clear(); // Write a line and then clear it, making it invisible
  }
  if (index < reportText.length) {
    term.write("READ_LINE" + reportText.slice(index) + "END_LINE\n").clear();
  }
  term.write("\x1B[0m\n").clear(); // Un-hide text
}

export class Result {
  public name: string;
  public arg1: i32;
  public arg2: i32;
  constructor(name: string, arg1: i32, arg2: i32) {
    this.name = name;
    this.arg1 = arg1;
    this.arg2 = arg2;
  }
  display(): string {
    let out = "";
    out += `${rainbow.boldMk(this.name)} `;
    if (this.arg1) {
      out += `${rainbow.boldMk(rainbow.red(this.arg1.toString() + " " + "failed"))}`;
    } else {
      out += `${rainbow.boldMk(rainbow.green("0 failed"))}`;
    }
    out += ` ${this.arg1 + this.arg2} total\n`;
    return out;
  }
  serialize(): string {
    return JSON.stringify(this);
  }
}


@json
export class Time {
  start: f64 = 0;
  end: f64 = 0;
  format(): string {
    return formatTime(this.end - this.start);
  }
}

class Unit {
  name: string;
  divisor: number;
}

function formatTime(time: f64): string {
  if (time < 0) return "0.00μs";

  const us = time * 1000;

  const units: Unit[] = [
    { name: "μs", divisor: 1 },
    { name: "ms", divisor: 1000 },
    { name: "s", divisor: 1000 * 1000 },
    { name: "m", divisor: 60 * 1000 * 1000 },
    { name: "h", divisor: 60 * 60 * 1000 * 1000 },
    { name: "d", divisor: 24 * 60 * 60 * 1000 * 1000 },
  ];

  for (let i = units.length - 1; i >= 0; i--) {
    const unit = units[i];
    if (us >= unit.divisor) {
      const value = (Math.round((us / unit.divisor) * 100) / 100).toString();
      return `${value}${unit.name}`;
    }
  }

  const _us = (Math.round(us * 100) / 100).toString();

  return `${_us}μs`;
}
