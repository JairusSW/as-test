import { rainbow } from "as-rainbow";
import { TestGroup } from "./src/group";
import { Expectation } from "./src/expectation";
import { formatTime } from "./util";
import { stringify } from "as-console/assembly";

/**
 * Enumeration representing the verdict of a test case.
 */
export enum Verdict {
    Unreachable,
    Ok,
    Fail
}

// Globals
let current_group: TestGroup | null = null;
let groups: TestGroup[] = [];

let before_all_callback: (() => void) | null = null;
let after_all_callback: (() => void) | null = null;

// @ts-ignore
@global let before_each_callback: (() => void) | null = null;
// @ts-ignore
@global let after_each_callback: (() => void) | null = null;
// @ts-ignore
@global let __test_options!: RunOptions;

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
    const group = new TestGroup(description, callback);

    current_group = group;
    groups.push(group);
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
    const group = new TestGroup(description, callback);

    current_group = group;
    groups.push(group);
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
    const group = new TestGroup(description, callback);

    current_group = group;
    groups.push(group);
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
    const result = new Expectation<T>(value);
    current_group!.addExpectation(result);

    return result;
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
 * Class defining options that can be passed to the `run` function.
 * 
 * Currently, it offers a single option:
 * 
 * - `log` (boolean, default: true): Controls whether enable the log() function
 **/
class RunOptions {
    log: boolean = true
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
    console.log(rainbow.boldMk(rainbow.green(` _____  _____      _____  _____  _____  _____ `)));
    console.log(rainbow.boldMk(rainbow.green(`|  _  ||   __| ___|_   _||   __||   __||_   _|`)));
    console.log(rainbow.boldMk(rainbow.green(`|     ||__   ||___| | |  |   __||__   |  | |  `)));
    console.log(rainbow.boldMk(rainbow.green(`|__|__||_____|      |_|  |_____||_____|  |_|  `)));
    console.log(rainbow.dimMk             ("\n------------------- v0.0.8 -------------------\n"));
    const suites = groups.length;
    let failed = 0;
    let tests = 0;
    let failed_tests = 0;
    let failed_suite_logs = "";
    const start = performance.now();
    for (let i = 0; i < groups.length; i++) {
        if (before_all_callback) before_all_callback();
        const suite = unchecked(groups[i]);
        suite.run();
        for (let i = 0; i < suite.results.length; i++) {
            const expectation = unchecked(suite.results[i]);
            const verdict = expectation.verdict;
            tests++;
            if (verdict == Verdict.Ok) {
                suite.passed++;
            } else if (verdict == Verdict.Fail) {
                suite.verdict = Verdict.Fail;
                suite.failed++;
                failed_tests++;
            }
        }
        if (suite.verdict == Verdict.Unreachable) {
            suite.verdict = Verdict.Ok;
            console.log(rainbow.bgGreenBright(" PASS ") + " " + rainbow.dimMk(suite.description) + "\n");
        } else {
            failed++;
            const txt = rainbow.bgRed(" FAIL ") + " " + rainbow.dimMk(suite.description) + "\n";
            failed_suite_logs += txt
            console.log(txt);
        }

        const report = suite.report();
        if (report) {
            if (report.passed) console.log(report.passed!);
            if (report.failed) failed_suite_logs += report.failed!;

        }
        if (after_all_callback) after_all_callback();
    }

    if (failed) {
        console.log(rainbow.red("------------------ [FAILED] ------------------\n"));
        console.log(failed_suite_logs);
        console.log(rainbow.red("----------------- [RESULTS] ------------------\n"));
    } else {
        console.log(rainbow.dimMk("----------------- [RESULTS] ------------------\n"));
    }
    const ms = performance.now() - start;
    console.log(rainbow.boldMk("Test Suites: ") + (failed ? rainbow.boldMk(rainbow.red(failed.toString() + " failed")) : rainbow.boldMk(rainbow.green(failed.toString() + " failed"))) + ", " + suites.toString() + " total");
    console.log(rainbow.boldMk("Tests:       ") + (failed_tests ? rainbow.boldMk(rainbow.red(failed_tests.toString() + " failed")) : rainbow.boldMk(rainbow.green(failed_tests.toString() + " failed"))) + ", " + tests.toString() + " total");
    console.log(rainbow.boldMk("Snapshots:   ") + "0 total");
    console.log(rainbow.boldMk("Time:        ") + formatTime(ms));
    if (failed) {
        process.exit(1)
    }
}