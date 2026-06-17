import { Time } from "..";
import { Expectation } from "./expectation";
import { Tests } from "./tests";
import { Log } from "./log";
import {
  after_each_callback,
  after_each_kinds,
  before_each_callback,
  before_each_kinds,
} from "..";
import { sendSuiteEnd, sendSuiteStart } from "../util/wipc";
import { escape, stringify } from "./stringify";

export class Suite {
  public file: string = "unknown";
  public order: i32 = 0;
  public time: Time = new Time();
  public description: string;
  public depth: i32 = 0;
  public snapshotCount: i32 = 0;
  public suites: Suite[] = [];
  public tests: Tests[] = [];
  public logs: Log[] = [];
  public kind: string;

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
    log.file = this.file;
    log.display();
  }

  run(): void {
    // @ts-ignore: current_suite is a @global, the parent for nested registration
    current_suite = this;
    this.time.start = performance.now();
    sendSuiteStart(this.file, this.depth, this.kind, this.description);
    const isSkippedCase =
      this.kind == "xdescribe" ||
      this.kind == "xtest" ||
      this.kind == "xit" ||
      this.kind == "xonly" ||
      this.kind == "todo";
    const isTestCase =
      this.kind == "test" ||
      this.kind == "it" ||
      this.kind == "only" ||
      this.kind == "xtest" ||
      this.kind == "xit" ||
      this.kind == "xonly" ||
      this.kind == "todo";

    if (isSkippedCase) {
      this.time.end = performance.now();
      this.verdict = "skip";
      sendSuiteEnd(
        this.file,
        this.depth,
        this.kind,
        this.description,
        this.verdict,
      );
      return;
    }

    // @ts-ignore: nullable function import resolved at runtime
    if (
      before_each_callback &&
      hookFiresFor(this.kind, before_each_kinds, isTestCase)
    ) {
      before_each_callback();
    }
    this.callback();
    // @ts-ignore: nullable function import resolved at runtime
    if (
      after_each_callback &&
      hookFiresFor(this.kind, after_each_kinds, isTestCase)
    ) {
      after_each_callback();
    }
    this.time.end = performance.now();

    const hasOnlyChildren = this.hasOnlyChildren();

    let hasFail = false;
    let hasOk = false;
    let hasSkip = false;
    for (let i = 0; i < this.suites.length; i++) {
      const suite = unchecked(this.suites[i]);
      if (hasOnlyChildren && suite.kind != "only") {
        suite.skip();
      } else {
        suite.run();
      }
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
    } else if (isTestCase) {
      this.verdict = "ok";
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

  skip(): void {
    // @ts-ignore: current_suite is a @global
    current_suite = this;
    this.time.start = performance.now();
    this.time.end = this.time.start;
    this.verdict = "skip";
    sendSuiteStart(this.file, this.depth, this.kind, this.description);
    sendSuiteEnd(
      this.file,
      this.depth,
      this.kind,
      this.description,
      this.verdict,
    );
  }

  private hasOnlyChildren(): bool {
    for (let i = 0; i < this.suites.length; i++) {
      if (unchecked(this.suites[i]).kind == "only") return true;
    }
    return false;
  }

  toJSON(): string {
    let out = "{";
    if (this.depth <= 0) {
      out += '"file":' + escape(this.file) + ",";
    }
    out += '"order":' + this.order.toString();
    out += ',"time":' + this.time.toJSON();
    out += ',"description":' + escape(this.description);
    out += ',"depth":' + this.depth.toString();
    out += ',"suites":' + serializeSuites(this.suites);
    out += ',"tests":' + serializeTests(this.tests);
    out += ',"logs":' + serializeLogs(this.logs);
    out += ',"kind":' + escape(this.kind);
    out += ',"verdict":' + escape(this.verdict);
    out += "}";
    return out;
  }
}

// Whether a beforeEach/afterEach hook should fire for a suite of `kind`. A
// `null` kinds list (the default) restricts the hook to test cases — the caller
// passes whether `kind` is one. An explicit list fires for exactly those kinds,
// which is how `beforeEach(fn, ["describe", "test"])` opts grouping blocks in.
function hookFiresFor(
  kind: string,
  kinds: string[] | null,
  isTestCaseKind: bool,
): bool {
  if (kinds === null) return isTestCaseKind;
  for (let i = 0; i < kinds.length; i++) {
    if (unchecked(kinds[i]) == kind) return true;
  }
  return false;
}

// Build into an array and join once: repeated `out += child` is O(n^2) in
// AssemblyScript (each concat copies the whole growing string), which dominates
// large suites (e.g. thousands of assertions in one test).
function serializeSuites(values: Suite[]): string {
  if (!values.length) return "[]";
  const parts = new Array<string>(values.length);
  for (let i = 0; i < values.length; i++) {
    parts[i] = unchecked(values[i]).toJSON();
  }
  return "[" + parts.join(",") + "]";
}

function serializeTests(values: Tests[]): string {
  if (!values.length) return "[]";
  const parts = new Array<string>(values.length);
  for (let i = 0; i < values.length; i++) {
    parts[i] = unchecked(values[i]).toJSON();
  }
  return "[" + parts.join(",") + "]";
}

function serializeLogs(values: Log[]): string {
  if (!values.length) return "[]";
  const parts = new Array<string>(values.length);
  for (let i = 0; i < values.length; i++) {
    parts[i] = unchecked(values[i]).toJSON();
  }
  return "[" + parts.join(",") + "]";
}
