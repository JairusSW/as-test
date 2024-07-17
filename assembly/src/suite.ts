import { rainbow } from "as-rainbow";
import { Time } from "..";
import { Expectation } from "./expectation";
import { Tests } from "./tests";
import { term } from "../util/term";
import { Log } from "./log";

@json
export class Suite {
  public file: string = "unknown";
  public order: i32 = 0;
  public time: Time = new Time();
  public description: string;
  public depth: i32 = 0;
  public suites: Suite[] = [];
  public tests: Tests[] = [];
  public logs: Log[] = [];
  public kind: string;

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
    const suiteDepth = "  ".repeat(this.depth + 1);
    const suiteLn = term.write(`${suiteDepth}${rainbow.bgBlackBright(" ... ")} ${rainbow.dimMk(this.description)}\n`);
    term.write("\n");
    this.callback();
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

    if (!suiteNone || this.tests.length) {
      this.verdict = "ok";
      suiteLn.edit(`${suiteDepth}${rainbow.bgGreenBright(" PASS ")} ${rainbow.dimMk(this.description)}\n`);
    } else if (this.verdict == "fail") {
      suiteLn.edit(`${suiteDepth}${rainbow.bgRed(" FAIL ")} ${rainbow.dimMk(this.description)}\n`);
    } else {
      suiteLn.edit(`${suiteDepth}${rainbow.bgBlackBright(" EMPTY ")} ${rainbow.dimMk(this.description)}\n`);
    }
  }
}
