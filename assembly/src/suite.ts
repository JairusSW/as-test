import { Time } from "..";
import { Expectation } from "./expectation";
import { Tests } from "./tests";
import { Log } from "./log";
import { after_each_callback, before_each_callback } from "..";
import { sendSuiteEnd, sendSuiteStart } from "../util/wipc";


@json
export class Suite {

  @omitif((self: Suite) => self.depth > 0)
  public file: string = "unknown";
  public order: i32 = 0;
  public time: Time = new Time();
  public description: string;
  public depth: i32 = 0;
  public suites: Suite[] = [];
  public tests: Tests[] = [];
  public logs: Log[] = [];
  public kind: string;

  @omit
  public parent: Suite | null = null;

  public verdict: string = "none";

  public callback: () => void;
  constructor(description: string, callback: () => void, kind: string) {
    this.description = description;
    this.callback = callback;
    this.kind = kind;
  }

  addExpectation<T extends Expectation<unknown>>(test: T): void {
    test.order = this.order++;
    this.tests.push(test);
  }
  addSuite(suite: Suite): void {
    suite.order = this.order++;
    this.suites.push(suite);
    suite.depth = this.depth + 1;
    suite.file = this.file;
    suite.parent = this;
  }
  addLog(log: Log): void {
    log.order = this.order++;
    this.logs.push(log);
    log.depth = this.depth + 1;
    log.display();
  }

  run(): void {
    // @ts-ignore
    current_suite = this;
    // @ts-ignore
    depth++;
    this.time.start = performance.now();
    sendSuiteStart(this.file, this.depth, this.kind, this.description);
    const isTestCase =
      this.kind == "test" ||
      this.kind == "it" ||
      this.kind == "xtest" ||
      this.kind == "xit";

    // @ts-ignore
    if (isTestCase && before_each_callback) before_each_callback();
    this.callback();
    // @ts-ignore
    if (isTestCase && after_each_callback) after_each_callback();
    this.time.end = performance.now();
    // @ts-ignore
    depth--;

    let suiteNone = true;
    for (let i = 0; i < this.suites.length; i++) {
      const suite = unchecked(this.suites[i]);
      suite.run();
      if (suite.verdict == "fail") {
        this.verdict = "fail";
        suiteNone = false;
      } else if (suite.verdict == "ok") {
        suiteNone = false;
      }
    }
    for (let i = 0; i < this.tests.length; i++) {
      const test = unchecked(this.tests[i]);
      if (test.verdict == "fail") {
        this.verdict = "fail";
        suiteNone = false;
      } else if (test.verdict == "ok") {
        suiteNone = false;
      }
    }

    if (this.verdict == "fail") {
    } else if (!suiteNone || this.tests.length) {
      this.verdict = "ok";
    }
    sendSuiteEnd(
      this.file,
      this.depth,
      this.kind,
      this.description,
      this.verdict,
    );
  }
}
