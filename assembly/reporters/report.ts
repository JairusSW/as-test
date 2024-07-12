import { Verdict } from "..";
import { Suite } from "../src/suite";
import { Tests } from "../src/tests";


@json
export class Report {
  file: string = "unknown";
  verdict: Verdict = Verdict.None;
  groups: SuiteReport[] = [];
}


@json
export class SuiteReport {
  kind: string = "";
  verdict: Verdict = Verdict.None;
  description: string = "";
  tests: TestReport[] = [];
  suites: SuiteReport[] = [];
  static wrap(suite: Suite): SuiteReport {
    const report = new SuiteReport();

    for (let i = 0; i < (<Suite>suite).suites.length; i++) {
      const _suite = unchecked((<Suite>suite).suites[i]);
      report.suites.push(SuiteReport.wrap(_suite));
    }

    for (let i = 0; i < (<Suite>suite).tests.length; i++) {
      const test = unchecked((<Suite>suite).tests[i]);
      report.tests.push(TestReport.wrap(test));
    }

    report.description = suite.description;
    report.verdict = suite.verdict;
    report.kind = suite.kind;

    return report;
  }
}


@json
export class TestReport {
  verdict: Verdict = Verdict.None;
  left: string = "";
  instr: string = "";
  right: string = "";
  static wrap(test: Tests): TestReport {
    const report = new TestReport();

    report.verdict = test.verdict;
    report.left = test.left;
    report.instr = test.instr;
    report.right = test.right;

    return report;
  }
}
