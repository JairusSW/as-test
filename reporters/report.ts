import { Verdict } from "../assembly";
import { Suite } from "../assembly/src/suite";
import { Tests } from "../assembly/src/tests";


@json
export class Time {
  start: f64 = 0;
  end: f64 = 0;
  format(): string {
    return formatTime(this.end - this.start);
  }
}


@json
export class Report {
  time: Time = new Time();
  plugins: string[] = [];
  file: string = "unknown";
  verdict: Verdict = Verdict.None;
  groups: SuiteReport[] = [];
}


@json
export class SuiteReport {
  time: Time = new Time();
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
    report.time = suite.time;

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

class Unit {
  name: string;
  divisor: number;
}

function formatTime(time: f64): string {
  if (time < 0) return "0.00μs";

  const us = time * 1000;

  const units: Unit[] = [
    { name: "μs", divisor: 1 },
    { name: "ms", divisor: 1000 },
    { name: "s", divisor: 1000 * 1000 },
    { name: "m", divisor: 60 * 1000 * 1000 },
    { name: "h", divisor: 60 * 60 * 1000 * 1000 },
    { name: "d", divisor: 24 * 60 * 60 * 1000 * 1000 },
  ];

  for (let i = units.length - 1; i >= 0; i--) {
    const unit = units[i];
    if (us >= unit.divisor) {
      const value = (Math.round((us / unit.divisor) * 100) / 100).toString();
      const precision = value.indexOf(".");
      return `${value.slice(0, precision) + value.slice(precision, precision + 3)}${unit.name}`;
    }
  }

  const _us = us.toString();
  const precision = _us.indexOf(".");

  return `${_us.slice(0, precision) + _us.slice(precision, precision + 3)}μs`;
}
