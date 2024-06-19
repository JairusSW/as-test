import { rainbow } from "as-rainbow";
import { TestGroup } from "./src/group";
import { Expectation } from "./src/expectation";
import { Verdict } from "./src/result";
import { formatTime } from "./util";

// Globals
let current_group: TestGroup | null = null;
let groups: TestGroup[] = [];

/**
 * Creates a test group containing multiple test cases
 * 
 * @param {string} description - The name of the test group
 * @param callback - The block containing the test cases for this group
 * 
 * @example
 * 
 * ```ts
 * describe("my test suite", () => {
 *  // Tests go here
 * });
 * ```
 */
export function describe(description: string, callback: () => void): void {
    const group = new TestGroup(description, callback);

    current_group = group;
    groups.push(group);
}

export function expect<T>(value: T): Expectation<T> {
    const result = new Expectation<T>(value);

    current_group!.addExpectation(result);

    //if (!result.tested) {
    //
    //}

    return result;
}

export function run(): void {
    console.log(rainbow.boldMk(rainbow.blue(
        ` _____ _____     _____ _____ _____ _____ 
|  _  |   __|___|_   _|   __|   __|_   _|
|     |__   |___| | | |   __|__   | | |  
|__|__|_____|     |_| |_____|_____| |_|  `)));
    console.log(rainbow.dimMk("\n-----------------------------------------\n"));
    const suites = groups.length;
    let failed = 0;
    let tests = 0;
    let failed_tests = 0;
    const start = performance.now();
    for (let i = 0; i < groups.length; i++) {
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
            console.log(rainbow.bgGreen(" PASS ") + " " + rainbow.dimMk(suite.description) + "\n");
        } else {
            failed++;
            console.log(rainbow.bgRed(" FAIL ") + " " + rainbow.dimMk(suite.description) + "\n");
        }

        const report = suite.report();
        if (report) console.log(report);
    }
    const ms = performance.now() - start;
    console.log(rainbow.dimMk("-----------------------------------------\n"));
    console.log(rainbow.boldMk("Test Suites: ") + rainbow.boldMk(rainbow.red(failed.toString() + " failed")) + ", " + suites.toString() + " total");
    console.log(rainbow.boldMk("Tests:       ") + rainbow.boldMk(rainbow.red(failed_tests.toString() + " failed")) + ", " + tests.toString() + " total");
    console.log(rainbow.boldMk("Snapshots:   ") + "0 total");
    console.log(rainbow.boldMk("Time:        ") + formatTime(ms))
}