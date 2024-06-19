import { Expectation } from "./expectation";
import { Verdict } from "./result";
export class TestGroup {
    public results: Expectation<usize>[] = [];

    public description: string;
    public executed: boolean = false;
    public verdict: Verdict = Verdict.Unreachable;

    public passed: i32 = 0;
    public failed: i32 = 0;

    public callback: () => void;
    constructor(description: string, callback: () => void) {
        this.description = description;
        this.callback = callback;
    }

    addExpectation<T extends Expectation<unknown>>(test: T): void {
        this.results.push(changetype<Expectation<usize>>(test));
    }

    run(): void {
        this.callback();
    }
}
