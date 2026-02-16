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
    const isSkippedCase =
      this.kind == "xdescribe" ||
      this.kind == "xtest" ||
      this.kind == "xit";
    const isTestCase =
      this.kind == "test" ||
      this.kind == "it" ||
      this.kind == "xtest" ||
      this.kind == "xit";

    if (isSkippedCase) {
      this.time.end = performance.now();
      this.verdict = "skip";
      // @ts-ignore
      depth--;
      sendSuiteEnd(
        this.file,
        this.depth,
        this.kind,
        this.description,
        this.verdict,
      );
      return;
    }

    // @ts-ignore
    if (isTestCase && before_each_callback) before_each_callback();
    this.callback();
    // @ts-ignore
    if (isTestCase && after_each_callback) after_each_callback();
    this.time.end = performance.now();
    // @ts-ignore
    depth--;

    let hasFail = false;
    let hasOk = false;
    let hasSkip = false;
    for (let i = 0; i < this.suites.length; i++) {
      const suite = unchecked(this.suites[i]);
      suite.run();
      if (suite.verdict == "fail") {
        hasFail = true;
      } else if (suite.verdict == "ok") {
        hasOk = true;
      } else if (suite.verdict == "skip") {
        hasSkip = true;
      }
    }
    for (let i = 0; i < this.tests.length; i++) {
      const test = unchecked(this.tests[i]);
      if (test.verdict == "fail") {
        hasFail = true;
      } else if (test.verdict == "ok") {
        hasOk = true;
      } else if (test.verdict == "skip") {
        hasSkip = true;
      }
    }

    if (hasFail) {
      this.verdict = "fail";
    } else if (hasOk) {
      this.verdict = "ok";
    } else if (hasSkip) {
      this.verdict = "skip";
    } else {
      this.verdict = "none";
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
