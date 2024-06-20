import { Verdict } from "..";
import { Expectation } from "./expectation";
import { Node } from "./node";
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

    report(): ReportLogs | null {
        let passed_logs = "";
        let failed_logs = "";
        for (let i = 0; i < this.results.length; i++) {
            const result = unchecked(this.results[i]);
            const report = result.report();
            if (report) {
                if (result.verdict === Verdict.Fail) failed_logs += report + "\n";
                else if (result.verdict === Verdict.Ok) passed_logs += report + "\n";
            }
        }
        return {
            passed: passed_logs.length ? passed_logs : null,
            failed: failed_logs.length ? failed_logs : null
        }
    }

    run(): void {
        this.callback();
    }
}


class ReportLogs {
    passed: string | null;
    failed: string | null;
}