import { Suite } from "./src/suite";
import { Expectation } from "./src/expectation";
import {
  __COVER,
  __POINTS,
  __UNCOVERED,
  __ALL_POINTS,
  CoverPoint,
} from "as-test/assembly/coverage";
import { Log } from "./src/log";
import {
  requestFuzzConfig as requestHostFuzzConfig,
  sendFileEnd,
  sendFileStart,
  sendReport,
} from "./util/wipc";
import { escape, stringify } from "./src/stringify";
import { bold, green, red } from "./util/format";
import {
  createFuzzer,
  FuzzerBase,
  FuzzerResult,
  prepareFuzzIteration,
} from "./src/fuzz";
export {
  ArrayOptions,
  BytesOptions,
  FloatOptions,
  Fuzzer0,
  Fuzzer1,
  Fuzzer2,
  Fuzzer3,
  FuzzerBase,
  FuzzerResult,
  FuzzSeed,
  IntegerOptions,
  StringOptions,
} from "./src/fuzz";
export { reflectEquals } from "./src/reflect";
export { stringify as __as_test_stringify } from "./src/stringify";

let entrySuites: Suite[] = [];
let entryFuzzers: FuzzerBase[] = [];
let globalExpectationSuite: Suite | null = null;

// @ts-ignore
const FILE = isDefined(ENTRY_FILE) ? ENTRY_FILE : "unknown";

// Globals
// @ts-ignore
@global let __mock_global: Map<string, u32> = new Map<string, u32>();
// @ts-ignore
@global let __mock_import: Map<string, u32> = new Map<string, u32>();
// @ts-ignore
@global let __mock_import_target_by_index: Map<u32, string> = new Map<
  u32,
  string
>();
// @ts-ignore
@global let current_suite: Suite | null = null;
// @ts-ignore
let before_all_callback: (() => void) | null = null;
// @ts-ignore
let after_all_callback: (() => void) | null = null;

export let before_each_callback: (() => void) | null = null;
export let after_each_callback: (() => void) | null = null;
// Suite kinds each hook fires before/after. `null` = the default set (test
// cases: test / it / only and their skip variants), excluding grouping blocks
// like `describe`. A caller-supplied list overrides this.
export let before_each_kinds: string[] | null = null;
export let after_each_kinds: string[] | null = null;
let __test_options!: RunOptions;

/**
 * Creates a test group containing multiple test cases.
 *
 * @param {string} description - The name of the test group
 * @param {() => void} callback - The block containing the test cases for this group
 *
 * @example
 * ```ts
 * describe("my test suite", () => {
 *   expect(1 + 3).toBe(4);
 *   // More tests here
 * });
 * ```
 */
export function describe(description: string, callback: () => void): void {
  registerSuite(description, callback, "describe");
}

/**
 * Creates a test group containing multiple test cases
 *
 * @param {string} description - The name of the test group
 * @param {() => void} callback - The block containing the test cases for this group
 *
 * @example
 *
 * ```ts
 * test("1 + 3 = 4", () => {
 *  expect(1 + 3).toBe(4);
 * });
 * ```
 */
export function test(description: string, callback: () => void): void {
  registerSuite(description, callback, "test");
}

/**
 * Creates a test group containing multiple test cases
 *
 * @param {string} description - The name of the test group
 * @param {() => void} callback - The block containing the test cases for this group
 *
 * @example
 *
 * ```ts
 * it("should perform additions", () => {
 *  expect(1 + 3).toBe(4);
 * });
 * ```
 */
export function it(description: string, callback: () => void): void {
  registerSuite(description, callback, "it");
}

/**
 * Creates a focused test case.
 */
export function only(description: string, callback: () => void): void {
  registerSuite(description, callback, "only");
}

/**
 * Creates a skipped focused test case.
 */
export function xonly(description: string, callback: () => void): void {
  registerSuite(description, callback, "xonly");
}

/**
 * Creates a todo test case placeholder.
 */
export function todo(description: string): void {
  registerSuite(description, (): void => {}, "todo");
}

/**
 * Creates a skipped test group.
 */
export function xdescribe(description: string, callback: () => void): void {
  registerSuite(description, callback, "xdescribe");
}

/**
 * Creates a skipped test case.
 */
export function xtest(description: string, callback: () => void): void {
  registerSuite(description, callback, "xtest");
}

/**
 * Creates a skipped test case alias.
 */
export function xit(description: string, callback: () => void): void {
  registerSuite(description, callback, "xit");
}

export function fuzz<T extends Function>(
  description: string,
  callback: T,
  operations: i32 = 0,
): FuzzerBase {
  const entry = createFuzzer(description, callback, false, operations);
  entryFuzzers.push(entry);
  return entry;
}

export function xfuzz<T extends Function>(
  description: string,
  callback: T,
  operations: i32 = 0,
): FuzzerBase {
  const entry = createFuzzer(description, callback, true, operations);
  entryFuzzers.push(entry);
  return entry;
}

/**
 * Creates an expectation object for making assertions within a test case.
 *
 * Use this function to chain assertions about a specific value.
 * The returned expectation object provides various methods for testing
 * different properties and conditions of the value.
 *
 * @param {T} value - The value to be asserted against.
 * @returns {Expectation<T>} - The expectation object for chaining assertions.
 *
 * @example
 * ```ts
 * test("number comparison", () => {
 *   expect(1 + 2).toBe(3);
 *   expect(5).toBeGreaterThan(3);
 * });
 * ```
 */
export function expect<T>(
  value: T,
  message: string = "",
  location: string = "",
): Expectation<T> {
  const test = new Expectation<T>(value, message, snapshotKey(), location);
  resolveExpectationSuite().addExpectation(test);

  return test;
}

/**
 * Creates a skipped expectation.
 */
export function xexpect<T>(
  value: T,
  message: string = "",
  location: string = "",
): Expectation<T> {
  return expect<T>(value, message, location).skip();
}

/**
 * Formats and prints content to the terminal
 * Can be disabled like so:
 *
 * ```js
 * // ...
 *
 * run({ log: false });
 * ```
 *
 * @param {T} data - The data to format and print
 */
export function log<T>(data: T): void {
  if (!__as_test_log_is_enabled()) return;
  __as_test_log_serialized(stringify<T>(data));
}

export function __as_test_log_is_enabled(): bool {
  return __test_options.log;
}

export function __as_test_log_serialized(formatted: string): void {
  if (!formatted) return;
  const lines = formatted.split("\n");
  const suite = resolveExpectationSuite();
  for (let i = 0; i < lines.length; i++) {
    const line = unchecked(lines[i]);
    suite.addLog(new Log(line));
  }
}

/**
 * Registers a callback function to be executed before each test group is run.
 *
 * @param {() => void} callback - The function to be executed before each test group.
 */
export function beforeAll(callback: () => void): void {
  before_all_callback = callback;
}

/**
 * Registers a callback function to be executed after each test group is run.
 *
 * @param {() => void} callback - The function to be executed after each test group.
 */
export function afterAll(callback: () => void): void {
  after_all_callback = callback;
}

/**
 * Registers a callback to run before each matching block.
 *
 * By default it runs before each test case (`test` / `it` / `only`, plus their
 * skip variants) and NOT before grouping blocks like `describe`. Pass `kinds`
 * to run before exactly the listed suite kinds instead, e.g.
 * `beforeEach(() => {}, ["describe", "test"])`.
 *
 * @param {() => void} callback - The function to run.
 * @param {string[] | null} kinds - Suite kinds to run before, or `null` for the
 *   default test-case kinds.
 */
export function beforeEach(
  callback: () => void,
  kinds: string[] | null = null,
): void {
  before_each_callback = callback;
  before_each_kinds = kinds;
}

/**
 * Registers a callback to run after each matching block.
 *
 * By default it runs after each test case (`test` / `it` / `only`, plus their
 * skip variants) and NOT after grouping blocks like `describe`. Pass `kinds`
 * to run after exactly the listed suite kinds instead, e.g.
 * `afterEach(() => {}, ["describe", "test"])`.
 *
 * @param {() => void} callback - The function to run.
 * @param {string[] | null} kinds - Suite kinds to run after, or `null` for the
 *   default test-case kinds.
 */
export function afterEach(
  callback: () => void,
  kinds: string[] | null = null,
): void {
  after_each_callback = callback;
  after_each_kinds = kinds;
}

/**
 * Replace all references to an existing function to new function
 * @param {Function} oldFn - name of function to mock
 * @param {Function} newFn - the function to substitute it with
 */
export function mockFn<T extends Function, U extends Function>(
  oldFn: T,
  newFn: U,
): void {}

/**
 * Restore references previously mocked with `mockFn`.
 * This applies to calls that appear after `unmockFn` in source order.
 */
export function unmockFn<T extends Function>(oldFn: T): void {}

export function mockImport<T extends Function>(oldFn: string, newFn: T): void {
  __mock_import.set(oldFn, newFn.index);
  // mocks.set(oldFn, new MockFn(oldFn, newFn).enable());
}

export function unmockImport(oldFn: string): void {
  __mock_import.delete(oldFn);
}

/**
 * Capture the current return value of a zero-arg callback and return a new function
 * that always returns the captured value.
 */
export function snapshotFn<T>(callback: () => T): () => T {
  const value = callback();
  return (): T => value;
}

/**
 * Class defining options that can be passed to the `run` function.
 *
 * Currently, it offers a single option:
 *
 * - `log` (boolean, default: true): Controls whether enable the log() function
 **/
class RunOptions {
  log: boolean = true;
}

/**
 * Runs all the test suites defined within the current test scope.
 *
 * This function executes all the test cases you've defined in your test suites.
 * It iterates through each suite, runs the tests within the suite, and tracks results.
 * Finally, it prints a colorful summary of the test execution.
 *
 * @param {RunOptions} [options] - Optional options for running tests.
 *
 * @example
 * ```javascript
 * describe("Math operations", () => {
 *   test("Addition", () => {
 *     expect(1 + 2).toBe(3);
 *   });
 *   // ... other tests
 * });
 *
 * run(); // Executes all tests in the "Math operations" suite
 * ```
 */
export function run(options: RunOptions = new RunOptions()): void {
  // @ts-ignore
  if (isDefined(AS_TEST_FUZZ)) {
    runFuzzers();
    return;
  }
  __test_options = options;
  const time = new Time();
  let fileVerdict = "none";
  const hasTopLevelOnly = containsOnlySuites(entrySuites);
  sendFileStart(FILE);
  time.start = performance.now();
  for (let i = 0; i < entrySuites.length; i++) {
    // @ts-ignore
    const suite = unchecked(entrySuites[i]);
    // @ts-ignore: current_suite is a @global; null between top-level suites
    current_suite = null;

    if (hasTopLevelOnly && suite.kind != "only") {
      suite.skip();
    } else {
      suite.run();
    }
    if (suite.verdict == "fail") {
      fileVerdict = "fail";
    } else if (fileVerdict != "fail" && suite.verdict == "ok") {
      fileVerdict = "ok";
    } else if (fileVerdict == "none" && suite.verdict == "skip") {
      fileVerdict = "skip";
    }

    // @ts-ignore: current_suite is a @global
    current_suite = null;
  }
  time.end = performance.now();
  sendFileEnd(FILE, fileVerdict, time.format());
  const report = new FileReport();
  report.suites = entrySuites;
  report.coverage = collectCoverage();
  sendReport(report.toJSON());
}

function containsOnlySuites(values: Suite[]): bool {
  for (let i = 0; i < values.length; i++) {
    if (unchecked(values[i]).kind == "only") return true;
  }
  return false;
}

class FuzzConfig {
  runs: i32 = 1000;
  seed: u64 = 1337;
  runsOverrideKind: i32 = 0;
  runsOverrideValue: f64 = 0.0;
}

class FuzzReport {
  fuzzers: FuzzerResult[] = [];

  toJSON(): string {
    let out = '{"fuzzers":[';
    for (let i = 0; i < this.fuzzers.length; i++) {
      if (i) out += ",";
      out += unchecked(this.fuzzers[i]).toJSON();
    }
    out += "]}";
    return out;
  }
}

function runFuzzers(): void {
  __test_options = new RunOptions();
  const config = requestFuzzConfig();
  const report = new FuzzReport();
  for (let i = 0; i < entryFuzzers.length; i++) {
    const fuzzer = unchecked(entryFuzzers[i]);
    prepareFuzzIteration();
    const result = fuzzer.run(config.seed, resolveFuzzerRuns(fuzzer, config));
    report.fuzzers.push(result);
  }
  sendReport(report.toJSON());
}

function requestFuzzConfig(): FuzzConfig {
  const out = new FuzzConfig();
  const reply = requestHostFuzzConfig();
  out.runs = reply.runs;
  out.seed = reply.seed;
  out.runsOverrideKind = reply.runsOverrideKind;
  out.runsOverrideValue = reply.runsOverrideValue;
  return out;
}

function resolveFuzzerRuns(fuzzer: FuzzerBase, config: FuzzConfig): i32 {
  const baseRuns = fuzzer.runsOr(config.runs);
  const resolved = applyFuzzRunsOverride(
    baseRuns,
    config.runsOverrideKind,
    config.runsOverrideValue,
  );
  return resolved > 0 ? resolved : 1;
}

function applyFuzzRunsOverride(baseRuns: i32, kind: i32, value: f64): i32 {
  if (kind == 1) return <i32>value;
  if (kind == 2) return <i32>Math.round(<f64>baseRuns * value);
  if (kind == 3) return baseRuns + <i32>value;
  if (kind == 4) {
    return baseRuns + <i32>Math.round((<f64>baseRuns * value) / 100.0);
  }
  return baseRuns;
}

function registerSuite(
  description: string,
  callback: () => void,
  kind: string,
): void {
  const suite = new Suite(description, callback, kind);
  // Callbacks run lazily during the run phase, and `current_suite` is always
  // the suite whose callback is currently executing (the same reference
  // `expect()`/`log()` resolve against). So a describe/test/it registered from
  // inside another block nests under it — including describe-in-describe.
  // `current_suite` is null only at collection time, i.e. a top-level suite.
  const parent = current_suite;
  if (parent !== null) {
    parent.addSuite(suite);
    return;
  }

  suite.file = FILE;
  entrySuites.push(suite);
}

function resolveExpectationSuite(): Suite {
  if (current_suite) return current_suite!;
  return ensureGlobalExpectationSuite();
}

function ensureGlobalExpectationSuite(): Suite {
  if (globalExpectationSuite) return globalExpectationSuite!;
  const suite = new Suite("global", (): void => {}, "describe");
  suite.file = FILE;
  globalExpectationSuite = suite;
  entrySuites.push(suite);
  return suite;
}

class CoverageReport {
  total: i32 = 0;
  covered: i32 = 0;
  uncovered: i32 = 0;
  percent: f64 = 100.0;
  points: CoveragePointReport[] = [];

  toJSON(): string {
    return (
      '{"total":' +
      this.total.toString() +
      ',"covered":' +
      this.covered.toString() +
      ',"uncovered":' +
      this.uncovered.toString() +
      ',"percent":' +
      this.percent.toString() +
      ',"points":' +
      serializeCoveragePoints(this.points) +
      "}"
    );
  }
}

class CoveragePointReport {
  hash: string = "";
  file: string = "";
  line: i32 = 0;
  column: i32 = 0;
  type: string = "";
  executed: bool = false;
  parentHash: string = "";
  scopeKind: string = "";
  scopeName: string = "";
  depth: i32 = 0;

  toJSON(): string {
    return (
      '{"hash":' +
      escape(this.hash) +
      ',"file":' +
      escape(this.file) +
      ',"line":' +
      this.line.toString() +
      ',"column":' +
      this.column.toString() +
      ',"type":' +
      escape(this.type) +
      ',"executed":' +
      (this.executed ? "true" : "false") +
      ',"parentHash":' +
      escape(this.parentHash) +
      ',"scopeKind":' +
      escape(this.scopeKind) +
      ',"scopeName":' +
      escape(this.scopeName) +
      ',"depth":' +
      this.depth.toString() +
      "}"
    );
  }
}

class FileReport {
  suites: Suite[] = [];
  coverage: CoverageReport = new CoverageReport();

  toJSON(): string {
    return (
      '{"suites":' +
      serializeSuites(this.suites) +
      ',"coverage":' +
      this.coverage.toJSON() +
      "}"
    );
  }
}

function serializeSuites(values: Suite[]): string {
  if (!values.length) return "[]";
  let out = "[";
  for (let i = 0; i < values.length; i++) {
    if (i) out += ",";
    out += unchecked(values[i]).toJSON();
  }
  out += "]";
  return out;
}

function serializeCoveragePoints(values: CoveragePointReport[]): string {
  if (!values.length) return "[]";
  let out = "[";
  for (let i = 0; i < values.length; i++) {
    if (i) out += ",";
    out += unchecked(values[i]).toJSON();
  }
  out += "]";
  return out;
}

function collectCoverage(): CoverageReport {
  const out = new CoverageReport();
  out.total = __POINTS();
  out.uncovered = __UNCOVERED();
  out.covered = out.total - out.uncovered;
  if (out.total <= 0) {
    out.percent = 100.0;
  } else {
    out.percent = (<f64>out.covered * 100.0) / <f64>out.total;
  }

  const points = __ALL_POINTS();
  for (let i = 0; i < points.length; i++) {
    const point = unchecked(points[i]);
    out.points.push(toCoveragePointReport(point));
  }
  return out;
}

function toCoveragePointReport(point: CoverPoint): CoveragePointReport {
  const out = new CoveragePointReport();
  out.hash = point.hash;
  out.file = point.file;
  out.line = point.line;
  out.column = point.column;
  out.type = point.type;
  out.executed = point.executed;
  out.parentHash = point.parentHash;
  out.scopeKind = point.scopeKind;
  out.scopeName = point.scopeName;
  out.depth = point.depth;
  return out;
}

function snapshotKey(): string {
  if (!current_suite) return FILE + "::global";
  const suite = current_suite!;
  const parts = new Array<string>();
  let cursor: Suite | null = suite;
  while (cursor) {
    parts.unshift(cursor.description);
    cursor = cursor.parent;
  }
  return FILE + "::" + parts.join(" > ");
}

export function nextUnnamedSnapshotKey(baseKey: string): string {
  if (!current_suite) return baseKey;
  const suite = current_suite!;
  suite.snapshotCount++;
  if (suite.snapshotCount <= 1) return baseKey;
  return baseKey + " #" + suite.snapshotCount.toString();
}

export function namedSnapshotKey(baseKey: string, name: string): string {
  return baseKey + " [" + name + "]";
}

export class Result {
  public name: string;
  public arg1: i32;
  public arg2: i32;
  constructor(name: string, arg1: i32, arg2: i32) {
    this.name = name;
    this.arg1 = arg1;
    this.arg2 = arg2;
  }
  display(): string {
    let out = "";
    out += `${bold(this.name)} `;
    if (this.arg1) {
      out += `${bold(red(this.arg1.toString() + " failed"))}`;
    } else {
      out += `${bold(green("0 failed"))}`;
    }
    out += ` ${this.arg1 + this.arg2} total\n`;
    return out;
  }
  toJSON(): string {
    return (
      '{"name":' +
      escape(this.name) +
      ',"arg1":' +
      this.arg1.toString() +
      ',"arg2":' +
      this.arg2.toString() +
      "}"
    );
  }
}

export class Time {
  start: f64 = 0;
  end: f64 = 0;
  format(): string {
    return formatTime(this.end - this.start);
  }

  toJSON(): string {
    return (
      '{"start":' +
      this.start.toString() +
      ',"end":' +
      this.end.toString() +
      "}"
    );
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
      return `${value}${unit.name}`;
    }
  }

  const _us = (Math.round(us * 100) / 100).toString();

  return `${_us}μs`;
}

export { mode, AS_TEST_MODE_NAME } from "./src/mode";
