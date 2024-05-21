import { rainbow } from "as-rainbow";
import { TestGroup } from "./src/group";
import { Variant } from "as-variant/assembly";
import { Expectation } from "./src/expectation";

// Globals
let current_group: TestGroup | null = null;

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
    const group = new TestGroup(description);

    current_group = group;

    console.log(rainbow.boldMk(`Running test suite: ${group.description}...`));

    callback();
}

export function expect<T>(value: T): Expectation {
    const result = new Expectation(Variant.from(value));

    current_group!.addExpectation(result);

    //if (!result.tested) {
        //
    //}

    return result;
}