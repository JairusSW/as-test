import { Expectation } from "./expectation";
import { Node } from "./node";
import { Verdict } from "./result";
export class TestGroup {
    public results: Node[] = [];

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
        this.results.push(test);
    }

    report(): string | null {
        let report = "";
        for (let i = 0; i < this.results.length; i++) {
            const result = unchecked(this.results[i]).report();
            if (result) report += result + "\n";
        }
        return report.length ? report : null;
    }

    run(): void {
        this.callback();
    }
}
