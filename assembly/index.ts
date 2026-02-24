import { Suite } from "./src/suite";
import { Expectation } from "./src/expectation";
import { stringify } from "as-console/stringify";
import {
  __COVER,
  __POINTS,
  __UNCOVERED,
  __ALL_POINTS,
  CoverPoint,
} from "as-test/assembly/coverage";
import { Log } from "./src/log";
import { sendFileEnd, sendFileStart, sendReport } from "./util/wipc";
import { quote } from "./util/json";

let entrySuites: Suite[] = [];

// @ts-ignore
const FILE = isDefined(ENTRY_FILE) ? ENTRY_FILE : "unknown";

class ImportSnapshot {
  hasValue: bool = false;
  value: u32 = 0;
}

const DEFAULT_IMPORT_SNAPSHOT_VERSION = "default";

// Globals
// @ts-ignore
@global let __mock_global: Map<string, u32> = new Map<string, u32>();
// @ts-ignore
@global let __mock_import: Map<string, u32> = new Map<string, u32>();
// @ts-ignore
@global let __mock_import_snapshots: Map<string, ImportSnapshot> = new Map<
  string,
  ImportSnapshot
>();
// @ts-ignore
@global let __mock_import_target_by_index: Map<u32, string> = new Map<
  u32,
  string
>();
// @ts-ignore
@global let suites: Suite[] = [];
// @ts-ignore
@global let depth: i32 = -1;
// @ts-ignore
@global let current_suite: Suite | null = null;
// @ts-ignore
let before_all_callback: (() => void) | null = null;
// @ts-ignore
let after_all_callback: (() => void) | null = null;

export let before_each_callback: (() => void) | null = null;
export let after_each_callback: (() => void) | null = null;
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

  if (current_suite) {
    current_suite!.addExpectation(test);
  }

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
  __as_test_log_serialized(__as_test_log_default<T>(data));
}

export function __as_test_log_default<T>(data: T): string {
  return stringify(data);
}

export function __as_test_log_is_enabled(): bool {
  return __test_options.log;
}

export function __as_test_log_serialized(formatted: string): void {
  if (!formatted) return;
  const lines = formatted.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = unchecked(lines[i]);
    if (current_suite) {
      current_suite!.addLog(new Log(line));
    }
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
 * Registers a callback function to be executed before each test case is run.
 *
 * @param {() => void} callback - The function to be executed before each test case.
 */
export function beforeEach(callback: () => void): void {
  before_each_callback = callback;
}

/**
 * Registers a callback function to be executed after each test case is run.
 *
 * @param {() => void} callback - The function to be executed after each test case.
 */
export function afterEach(callback: () => void): void {
  after_each_callback = callback;
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
 * Save a single import mock value for the given version.
 *
 * Accepts either:
 * - `snapshotImport(importOrPath, version)`
 * - `snapshotImport(importOrPath, () => { ... })` (uses default version)
 *
 * `imp` accepts either a string import path (e.g. "mock.foo") or the imported function.
 */
export function snapshotImport<T, V>(imp: T, versionOrCapture: V): void {
  const importKey = resolveImportKey<T>(imp);
  if (isFunction<V>(versionOrCapture)) {
    // @ts-ignore
    versionOrCapture();
    saveImportSnapshot(importKey, DEFAULT_IMPORT_SNAPSHOT_VERSION);
    return;
  }
  saveImportSnapshot(importKey, versionKey<V>(versionOrCapture));
}

/**
 * Restore a single import mock value for the given version.
 *
 * Accepts either a string import path (e.g. "mock.foo") or the imported function.
 */
export function restoreImport<T, V>(imp: T, version: V): void {
  const importKey = resolveImportKey<T>(imp);
  const snapshotKey = importSnapshotKey(importKey, versionKey<V>(version));
  if (!__mock_import_snapshots.has(snapshotKey)) return;
  const snapshot = __mock_import_snapshots.get(snapshotKey);
  if (snapshot.hasValue) {
    __mock_import.set(importKey, snapshot.value);
  } else {
    __mock_import.delete(importKey);
  }
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
  __test_options = options;
  const time = new Time();
  let fileVerdict = "none";
  sendFileStart(FILE);
  time.start = performance.now();
  for (let i = 0; i < entrySuites.length; i++) {
    // @ts-ignore
    const suite = unchecked(entrySuites[i]);
    suites = [suite];

    current_suite = suite;
    depth = -1;
    current_suite = null;

    suite.run();
    if (suite.verdict == "fail") {
      fileVerdict = "fail";
    } else if (fileVerdict != "fail" && suite.verdict == "ok") {
      fileVerdict = "ok";
    } else if (fileVerdict == "none" && suite.verdict == "skip") {
      fileVerdict = "skip";
    }

    suites = [];
    depth = -1;
    current_suite = null;
  }
  time.end = performance.now();
  sendFileEnd(FILE, fileVerdict, time.format());
  const report = new FileReport();
  report.suites = entrySuites;
  report.coverage = collectCoverage();
  sendReport(report.serialize());
}

function registerSuite(
  description: string,
  callback: () => void,
  kind: string,
): void {
  const suite = new Suite(description, callback, kind);
  if (depth >= 0) {
    const _suite = suites[depth];
    if (_suite.depth == depth) {
      _suite.addSuite(suite);
      return;
    }
    suite.depth = ++depth;
    suites.push(suite);
    return;
  }

  suite.file = FILE;
  entrySuites.push(suite);
  suites.push(suite);
}

class CoverageReport {
  total: i32 = 0;
  covered: i32 = 0;
  uncovered: i32 = 0;
  percent: f64 = 100.0;
  points: CoveragePointReport[] = [];

  serialize(): string {
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

  serialize(): string {
    return (
      '{"hash":' +
      quote(this.hash) +
      ',"file":' +
      quote(this.file) +
      ',"line":' +
      this.line.toString() +
      ',"column":' +
      this.column.toString() +
      ',"type":' +
      quote(this.type) +
      ',"executed":' +
      (this.executed ? "true" : "false") +
      "}"
    );
  }
}

class FileReport {
  suites: Suite[] = [];
  coverage: CoverageReport = new CoverageReport();

  serialize(): string {
    return (
      '{"suites":' +
      serializeSuites(this.suites) +
      ',"coverage":' +
      this.coverage.serialize() +
      "}"
    );
  }
}

function serializeSuites(values: Suite[]): string {
  if (!values.length) return "[]";
  let out = "[";
  for (let i = 0; i < values.length; i++) {
    if (i) out += ",";
    out += unchecked(values[i]).serialize();
  }
  out += "]";
  return out;
}

function serializeCoveragePoints(values: CoveragePointReport[]): string {
  if (!values.length) return "[]";
  let out = "[";
  for (let i = 0; i < values.length; i++) {
    if (i) out += ",";
    out += unchecked(values[i]).serialize();
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
  return out;
}

function snapshotKey(): string {
  if (!current_suite) return FILE + "::global::0";
  const suite = current_suite!;
  const parts = new Array<string>();
  let cursor: Suite | null = suite;
  while (cursor) {
    parts.unshift(cursor.description);
    cursor = cursor.parent;
  }
  const path = parts.join(" > ");
  return FILE + "::" + path + "::" + suite.tests.length.toString();
}

function resolveImportKey<T>(imp: T): string {
  if (isString<T>()) {
    // @ts-ignore
    return imp as string;
  }
  // @ts-ignore
  const index = imp.index as u32;
  if (__mock_import_target_by_index.has(index)) {
    return __mock_import_target_by_index.get(index);
  }
  return index.toString();
}

function importSnapshotKey(importKey: string, version: string): string {
  return importKey + "::" + version;
}

function versionKey<V>(version: V): string {
  if (isString<V>()) {
    // @ts-ignore
    return version as string;
  }
  if (isInteger<V>()) {
    // @ts-ignore
    return (<i64>version).toString();
  }
  ERROR("snapshot/restore version must be string or integer");
  return "";
}

function saveImportSnapshot(importKey: string, version: string): void {
  const snapshotKey = importSnapshotKey(importKey, version);
  const snapshot = new ImportSnapshot();
  if (__mock_import.has(importKey)) {
    snapshot.hasValue = true;
    snapshot.value = __mock_import.get(importKey);
  }
  __mock_import_snapshots.set(snapshotKey, snapshot);
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
    out += `${rainbow.boldMk(this.name)} `;
    if (this.arg1) {
      out += `${rainbow.boldMk(rainbow.red(this.arg1.toString() + " " + "failed"))}`;
    } else {
      out += `${rainbow.boldMk(rainbow.green("0 failed"))}`;
    }
    out += ` ${this.arg1 + this.arg2} total\n`;
    return out;
  }
  serialize(): string {
    return (
      '{"name":' +
      quote(this.name) +
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

  serialize(): string {
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
