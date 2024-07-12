import { Verdict } from "..";
import { Expectation } from "./expectation";
import { Tests } from "./tests";
export class Suite {
  public type: string = "Suite";
  public description: string;
  public depth: i32 = 0;
  public suites: Suite[] = [];
  public tests: Tests[] = [];

  public verdict: Verdict = Verdict.None;

  public callback: () => void;
  constructor(description: string, callback: () => void) {
    this.description = description;
    this.callback = callback;
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
    this.callback();
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
  }
}
