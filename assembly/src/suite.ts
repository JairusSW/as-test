import { rainbow } from "as-rainbow";
import { getDepth, Verdict } from "..";
import { Time } from "../../reporters/report";
import { Expectation } from "./expectation";
import { Tests } from "./tests";
import { term } from "../util/term";

export type SuiteKind = string;
export namespace SuiteKind {
  export const It = "it";
  export const Describe = "describe";
  export const Test = "test";
}

export class Suite {
  public time: Time = new Time();
  public description: string;
  public depth: i32 = 0;
  public suites: Suite[] = [];
  public tests: Tests[] = [];
  public logs: string[] = [];
  public kind: SuiteKind;

  public verdict: Verdict = Verdict.None;

  public callback: () => void;
  constructor(description: string, callback: () => void, kind: SuiteKind) {
    this.description = description;
    this.callback = callback;
    this.kind = kind;
  }

  addExpectation<T extends Expectation<unknown>>(test: T): void {
    this.tests.push(test);
  }
  addSuite(suite: Suite): void {
    this.suites.push(suite);
  }

  run(): void {
    // @ts-ignore
    current_suite = this;
    // @ts-ignore
    depth++;
    this.time.start = performance.now();
    const suiteDepth = getDepth();
    const suiteLn = term.write(`${suiteDepth}${rainbow.bgBlackBright(" ... ")} ${rainbow.dimMk(this.description)}\n`);
    term.write("\n");
    this.callback();
    this.time.end = performance.now();
    // @ts-ignore
    depth--;
    for (let i = 0; i < this.suites.length; i++) {
      const suite = unchecked(this.suites[i]);
      suite.run();
      if (suite.verdict === Verdict.Fail) {
        this.verdict = Verdict.Fail;
        break;
      }
    }
    for (let i = 0; i < this.tests.length; i++) {
      const test = unchecked(this.tests[i]);
      if (test.verdict === Verdict.Fail) {
        this.verdict = Verdict.Fail;
        break;
      }
    }
    if (this.verdict === Verdict.None) {
      if (this.tests.length) this.verdict = Verdict.Ok;
      if (this.suites.length) this.verdict = Verdict.Ok;
    }
    suiteLn.edit(`${suiteDepth}${rainbow.bgGreenBright(" PASS ")} ${rainbow.dimMk(this.description)} ${rainbow.dimMk(this.time.format())}\n`);
  }
}
