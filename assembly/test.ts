import {
    describe,
    expect,
    test, // Alias for `it`
    beforeAll,
    afterAll,
    beforeEach,
    afterEach,
    log,
    run
} from ".";


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