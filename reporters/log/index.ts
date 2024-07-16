import { rainbow } from "as-rainbow";
import { Report, SuiteReport, TestReport, Time } from "../report";
import { Verdict } from "../../assembly/index";
import { diff } from "../../assembly/util/helpers";
import { JSON } from "json-as";
import { Result } from "../../plugins/index";
class LogReporter {
    public logs: Report[];
    private depth: string = "";

    private passedFiles: i32 = 0;
    private failedFiles: i32 = 0;

    private passedSuites: i32 = 0;
    private failedSuites: i32 = 0;

    private passedTests: i32 = 0;
    private failedTests: i32 = 0;

    private failed: SuiteReport[] = [];


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
            if (log.verdict === Verdict.Fail) this.failedFiles++;
            else this.passedFiles++;
            out += this.reportLog(log);
        }
        out += this.summarize();
        return out;
    }
    reportLog(log: Report): string {
        // @ts-ignore
        let out: string = "";

        out += `${rainbow.bgCyanBright(" FILE ")} ${rainbow.dimMk(log.file)} ${rainbow.italicMk(log.time.format())}\n\n`;

        for (let i = 0; i < log.groups.length; i++) {
            const group = unchecked(log.groups[i]);
            if (group.verdict === Verdict.Fail) {
                this.failedSuites++;
            } else {
                this.passedSuites++;
            }
            out += this.reportSuite(group);
        }

        return out;
    }
    reportSuite(suite: SuiteReport): string {
        let out = "";
        this.depthInc();
        if (suite.verdict == Verdict.Ok) {
            this.passedTests++;
            out += `${this.depth}${rainbow.bgGreenBright(" PASS ")} ${rainbow.dimMk(suite.description)} ${rainbow.italicMk(suite.time.format())}\n\n`;
        } else if (suite.verdict == Verdict.Fail) {
            this.failedTests++;
            out += `${this.depth}${rainbow.bgRed(" FAIL ")} ${rainbow.dimMk(suite.description)} ${rainbow.italicMk(suite.time.format())}\n\n`;
        } else if (suite.verdict == Verdict.None) {
            out += `${this.depth}${rainbow.bgBlackBright(" EMPTY ")} ${rainbow.dimMk(suite.description)} ${rainbow.italicMk("0.00μs")}\n\n`;
        }

        for (let i = 0; i < suite.tests.length; i++) {
            const _test = unchecked(suite.tests[i]);
            if (_test.verdict != Verdict.Ok) {
                if (!this.failed.includes(suite)) this.failed.push(suite);
                out += this.reportTest(_test);
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
    errors(): string {
        let out: string = "";
        if (!this.failed.length) return "";
        out += rainbow.dimMk("----------------- [FAILED] -------------------\n\n");
        for (let i = 0; i < this.failed.length; i++) {
            const suite = unchecked(this.failed[i]);
            out += `${rainbow.bgRed(" FAIL ")} ${rainbow.dimMk(suite.description)} ${rainbow.italicMk(suite.time.format())}\n\n`;
            for (let i = 0; i < suite.tests.length; i++) {
                const _test = unchecked(suite.tests[i]);
                if (_test.verdict != Verdict.Ok) {
                    out += this.reportTest(_test);
                }
            }
        }
        return out;
    }
    summarize(): string {
        let out: string = "";
        out += this.errors();
        out += rainbow.dimMk("----------------- [RESULTS] ------------------\n\n");

        const filesResult = new Result("Files:   ", this.failedFiles, this.passedFiles);
        out += filesResult.display();

        const suitesResult = new Result("Suites:  ", this.failedSuites, this.passedSuites);
        out += suitesResult.display();

        const testsResult = new Result("Tests:   ", this.failedTests, this.passedTests);
        out += testsResult.display();

        // @ts-ignore
        const time = new Time();
        for (let i = 0; i < this.logs.length; i++) {
            const log = unchecked(this.logs[i]);
            time.end += log.time.end - log.time.start;
        }

        out += `${rainbow.boldMk("Time:")}     ${time.format()}`;
        return out;
    }
}

export function report(_logs: string): void {
    const logs = JSON.parse<Report[]>(_logs);
    const reporter = new LogReporter(logs);
    const out = reporter.report();
    console.log(out);
}
