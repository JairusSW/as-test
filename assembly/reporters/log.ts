import { rainbow } from "as-rainbow";
import { Report, SuiteReport, TestReport } from "./report";
import { Verdict } from "..";
import { diff } from "../util/helpers";
import { JSON } from "json-as";

class LogReporter {
    public logs: Report[];
    private depth: string = "";
    private failedSuites: i32 = 0;
    private passedSuites: i32 = 0;
    private failedTests: i32 = 0;
    private passedTests: i32 = 0;

    private initialized: boolean = false;
    constructor(logs: Report[]) {
        this.logs = logs;
    }
    depthInc(): void {
        this.depth += "  ";
    }
    depthDec(): void {
        this.depth = this.depth.slice(0, this.depth.length - 2);
    }
    init(): string {
        if (this.initialized) return "";
        this.initialized = true;
        let out: string = "";
        out += rainbow.boldMk(
            rainbow.blueBright(
                ` _____  _____      _____  _____  _____  _____ \n` +
                `|  _  ||   __| ___|_   _||   __||   __||_   _|\n` +
                `|     ||__   ||___| | |  |   __||__   |  | |  \n` +
                `|__|__||_____|      |_|  |_____||_____|  |_|  \n`,
            ),
        );
        out += rainbow.dimMk(
            "\n------------------- v0.2.1 -------------------\n\n",
        );

        // @ts-ignore
        if (isDefined(COVERAGE_USE)) {
            out +=
                rainbow.bgBlueBright(" PLUGIN ") +
                " " +
                rainbow.dimMk("Using Code Coverage") +
                "\n\n";
        }
        return out;
    }
    report(): string {
        let out: string = "";
        out += this.init();
        for (let i = 0; i < this.logs.length; i++) {
            const log = unchecked(this.logs[i]);
            out += this.reportLog(log);
        }
        out += this.summarize();
        return out;
    }
    reportLog(log: Report): string {
        let out: string = "";
        
        out +=
            rainbow.bgCyanBright(" FILE ") +
            " " +
            rainbow.dimMk("./assembly/__tests__/example.spec.ts") +
            "\n\n";

        for (let i = 0; i < log.groups.length; i++) {
            const group = unchecked(log.groups[i]);
            out += this.reportSuite(group);
        }

        return out;
    }
    reportSuite(suite: SuiteReport): string {
        let out = "";
        this.depthInc();
        if (suite.verdict == Verdict.Ok) {
            this.passedSuites++;
            out +=
                this.depth +
                rainbow.bgGreenBright(" PASS ") +
                " " +
                rainbow.dimMk(suite.description) +
                "\n\n";
        } else if (suite.verdict == Verdict.Fail) {
            this.failedSuites++;
            out +=
                this.depth +
                rainbow.bgRedBright(" FAIL ") +
                " " +
                rainbow.dimMk(suite.description) +
                "\n\n";
        } else if (suite.verdict == Verdict.None) {
            out +=
                this.depth +
                rainbow.bgBlackBright(" EMPTY ") +
                " " +
                rainbow.dimMk(suite.description) +
                "\n\n";
        }

        for (let i = 0; i < suite.tests.length; i++) {
            const _test = unchecked(suite.tests[i]);
            if (_test.verdict != Verdict.Ok) {
                this.passedTests++;
                out += this.reportTest(_test);
            } else {
                this.failedTests++;
            }
        }

        for (let i = 0; i < suite.suites.length; i++) {
            const _suite = unchecked(suite.suites[i]);
            out += this.reportSuite(_suite);
        }
        this.depthDec();
        return out;
    }
    reportTest(test: TestReport): string {
        let out: string = "";
        this.depthInc();
        const dif = diff(test.left, test.right);
        out +=
            this.depth +
            rainbow.dimMk("(expected) ->") +
            " " +
            rainbow.boldMk(dif.left) +
            "\n";
        out +=
            this.depth +
            rainbow.dimMk("(received) ->") +
            " " +
            rainbow.boldMk(dif.right) +
            "\n\n";
        this.depthDec();
        return out;
    }
    summarize(): string {
        let out: string = "";
        out += rainbow.dimMk("----------------- [RESULTS] ------------------\n\n");

        if (this.failedSuites) {
            out +=
                rainbow.boldMk("Suites:") +
                " " +
                rainbow.boldMk(
                    rainbow.red(this.failedSuites.toString() + " " + "failed"),
                ) +
                ", " +
                (this.passedSuites + this.failedSuites).toString() +
                " total" +
                "\n";
            out +=
                rainbow.boldMk("Tests:") +
                " " +
                rainbow.boldMk(
                    rainbow.red(this.failedTests.toString() + " " + "failed"),
                ) +
                ", " +
                (this.passedTests + this.failedTests).toString() +
                " total" +
                "\n";
        } else {
            out +=
                rainbow.boldMk("Suites:") +
                " " +
                rainbow.boldMk(rainbow.green("0 failed")) +
                ", " +
                (this.passedSuites + this.failedSuites).toString() +
                " total" +
                "\n";
            out +=
                rainbow.boldMk("Tests:") +
                " " +
                rainbow.boldMk(
                    rainbow.green("0 failed"),
                ) +
                ", " +
                (this.passedTests + this.failedTests).toString() +
                " total" +
                "\n";
        }
        return out;
    }
}

export function report(_logs: string): void {
    const logs = JSON.parse<Report[]>(_logs);
    const reporter = new LogReporter(logs);
    const out = reporter.report();
    console.log(out);
}
