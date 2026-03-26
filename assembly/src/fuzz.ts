import { quote } from "../util/json";

export class StringOptions {
  charset: string = "ascii";
  min: i32 = 0;
  max: i32 = 32;
  include: i32[] = [];
  exclude: i32[] = [];
  prefix: string = "";
  suffix: string = "";
}

export class IntegerOptions<T> {
  min!: T;
  max!: T;
  exclude: T[] = [];
}

export class FloatOptions<T> {
  min!: T;
  max!: T;
  exclude: T[] = [];
}

export class BytesOptions {
  min: i32 = 0;
  max: i32 = 32;
  include: u8[] = [];
  exclude: u8[] = [];
}

export class ArrayOptions {
  min: i32 = 0;
  max: i32 = 16;
}

export class FuzzSeed {
  constructor(private state: u64) {}

  boolean(): bool {
    return (this.nextU32() & 1) == 1;
  }

  pick<T>(values: T[]): T {
    if (!values.length) panic();
    return unchecked(values[this.nextRange(0, values.length - 1)]);
  }

  i32(options: IntegerOptions<i32> = new IntegerOptions<i32>()): i32 {
    return this.nextI32InRange(options.min, options.max, options.exclude);
  }

  u32(options: IntegerOptions<u32> = new IntegerOptions<u32>()): u32 {
    return this.nextU32InRange(options.min, options.max, options.exclude);
  }

  f32(options: FloatOptions<f32> = new FloatOptions<f32>()): f32 {
    return <f32>(
      this.nextF64InRange<f32>(options.min, options.max, options.exclude)
    );
  }

  f64(options: FloatOptions<f64> = new FloatOptions<f64>()): f64 {
    return this.nextF64InRange<f64>(options.min, options.max, options.exclude);
  }

  bytes(options: BytesOptions = new BytesOptions()): Uint8Array {
    validateLengthRange("seed.bytes()", options.min, options.max);
    const length = this.nextRange(options.min, options.max);
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      out[i] = this.byteFromOptions(options);
    }
    return out;
  }

  buffer(options: BytesOptions = new BytesOptions()): ArrayBuffer {
    return this.bytes(options).buffer;
  }

  string(options: StringOptions = new StringOptions()): string {
    validateLengthRange("seed.string()", options.min, options.max);
    const alphabet = buildAlphabet(options);
    if (!alphabet.length) {
      panic();
    }
    const length = this.nextRange(options.min, options.max);
    let out = options.prefix;
    for (let i = 0; i < length; i++) {
      out += String.fromCharCode(this.pick(alphabet));
    }
    out += options.suffix;
    return out;
  }

  array<T>(
    item: (seed: FuzzSeed) => T,
    options: ArrayOptions = new ArrayOptions(),
  ): Array<T> {
    validateLengthRange("seed.array()", options.min, options.max);
    const length = this.nextRange(options.min, options.max);
    const out = new Array<T>(length);
    for (let i = 0; i < length; i++) {
      unchecked((out[i] = item(this)));
    }
    return out;
  }

  private byteFromOptions(options: BytesOptions): u8 {
    const include = options.include;
    const exclude = options.exclude;
    if (include.length) {
      for (let attempts = 0; attempts < 1024; attempts++) {
        const picked = unchecked(
          include[this.nextRange(0, include.length - 1)],
        );
        if (!exclude.includes(picked)) return picked;
      }
      panic();
    }
    for (let attempts = 0; attempts < 1024; attempts++) {
      const value = <u8>(this.nextU32() & 0xff);
      if (!exclude.includes(value)) return value;
    }
    panic();
    return 0;
  }

  private nextI32InRange(min: i32, max: i32, exclude: i32[]): i32 {
    if (max < min) panic();
    for (let attempts = 0; attempts < 1024; attempts++) {
      const value =
        max <= min ? min : min + <i32>(this.nextU32() % <u32>(max - min + 1));
      if (!containsValue<i32>(exclude, value)) return value;
    }
    panic();
    return min;
  }

  private nextU32InRange(min: u32, max: u32, exclude: u32[]): u32 {
    if (max < min) panic();
    for (let attempts = 0; attempts < 1024; attempts++) {
      const value = max <= min ? min : min + (this.nextU32() % (max - min + 1));
      if (!containsValue<u32>(exclude, value)) return value;
    }
    panic();
    return min;
  }

  private nextF64InRange<T>(min: T, max: T, exclude: T[]): f64 {
    const left = <f64>min;
    const right = <f64>max;
    if (right < left) panic();
    for (let attempts = 0; attempts < 1024; attempts++) {
      const value = left + (right - left) * this.nextUnit();
      if (!containsFloatValue<T>(exclude, changetype<T>(value))) return value;
    }
    panic();
    return left;
  }

  private nextRange(min: i32, max: i32): i32 {
    if (max <= min) return min;
    return min + <i32>(this.nextU32() % <u32>(max - min + 1));
  }

  private nextUnit(): f64 {
    return <f64>this.nextU32() / <f64>u32.MAX_VALUE;
  }

  private nextU32(): u32 {
    this.state += 0x9e3779b97f4a7c15;
    let z = this.state;
    z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9;
    z = (z ^ (z >> 27)) * 0x94d049bb133111eb;
    return <u32>(z ^ (z >> 31));
  }

  private nextU64(): u64 {
    const hi = <u64>this.nextU32();
    const lo = <u64>this.nextU32();
    return (hi << 32) | lo;
  }
}

export abstract class FuzzerBase {
  public name: string;
  public skipped: bool;
  constructor(name: string, skipped: bool = false) {
    this.name = name;
    this.skipped = skipped;
  }

  generate<T extends Function>(_generator: T): this {
    return this;
  }

  abstract run(seed: u64, runs: i32): FuzzerResult;
}

export class FuzzerResult {
  public name: string = "";
  public runs: i32 = 0;
  public passed: i32 = 0;
  public failed: i32 = 0;
  public crashed: i32 = 0;
  public skipped: i32 = 0;
  public timeStart: f64 = 0;
  public timeEnd: f64 = 0;
  public failureInstr: string = "";
  public failureLeft: string = "";
  public failureRight: string = "";
  public failureMessage: string = "";

  serialize(): string {
    return (
      '{"name":"' +
      this.name +
      '","runs":' +
      this.runs.toString() +
      ',"passed":' +
      this.passed.toString() +
      ',"failed":' +
      this.failed.toString() +
      ',"crashed":' +
      this.crashed.toString() +
      ',"skipped":' +
      this.skipped.toString() +
      ',"time":{"start":' +
      this.timeStart.toString() +
      ',"end":' +
      this.timeEnd.toString() +
      '},"failure":{"instr":' +
      quote(this.failureInstr) +
      ',"left":' +
      quote(this.failureLeft) +
      ',"right":' +
      quote(this.failureRight) +
      ',"message":' +
      quote(this.failureMessage) +
      "}}"
    );
  }
}

let __fuzz_calls: i32 = 0;
let __fuzz_returns_bool: bool = false;
let __fuzz_callback0: (() => usize) | null = null;
let __fuzz_callback1: ((a: usize) => usize) | null = null;
let __fuzz_callback2: ((a: usize, b: usize) => usize) | null = null;
let __fuzz_callback3: ((a: usize, b: usize, c: usize) => usize) | null = null;

function __fuzz_run0(): usize {
  __fuzz_calls++;
  const callback = __fuzz_callback0;
  if (callback == null) panic();
  const result = callback();
  if (__fuzz_returns_bool && result == 0) {
    failFuzzIteration(
      "return",
      "false",
      "true",
      "fuzz callback returned false",
    );
  }
  return result;
}

function __fuzz_run1(a: usize): usize {
  __fuzz_calls++;
  const callback = __fuzz_callback1;
  if (callback == null) panic();
  const result = callback(a);
  if (__fuzz_returns_bool && result == 0) {
    failFuzzIteration(
      "return",
      "false",
      "true",
      "fuzz callback returned false",
    );
  }
  return result;
}

function __fuzz_run2(a: usize, b: usize): usize {
  __fuzz_calls++;
  const callback = __fuzz_callback2;
  if (callback == null) panic();
  const result = callback(a, b);
  if (__fuzz_returns_bool && result == 0) {
    failFuzzIteration(
      "return",
      "false",
      "true",
      "fuzz callback returned false",
    );
  }
  return result;
}

function __fuzz_run3(a: usize, b: usize, c: usize): usize {
  __fuzz_calls++;
  const callback = __fuzz_callback3;
  if (callback == null) panic();
  const result = callback(a, b, c);
  if (__fuzz_returns_bool && result == 0) {
    failFuzzIteration(
      "return",
      "false",
      "true",
      "fuzz callback returned false",
    );
  }
  return result;
}

function createResult(name: string, runs: i32): FuzzerResult {
  const result = new FuzzerResult();
  result.name = name;
  result.runs = runs;
  result.timeStart = performance.now();
  return result;
}

function createSkippedResult(name: string): FuzzerResult {
  const result = createResult(name, 0);
  result.skipped = 1;
  result.timeEnd = result.timeStart;
  return result;
}

function recordResult(result: FuzzerResult): void {
  if (__as_test_fuzz_failed) {
    result.failed++;
    if (!result.failureInstr.length && __as_test_fuzz_failure_instr.length) {
      result.failureInstr = __as_test_fuzz_failure_instr;
      result.failureLeft = __as_test_fuzz_failure_left;
      result.failureRight = __as_test_fuzz_failure_right;
      result.failureMessage = __as_test_fuzz_failure_message;
    }
  } else {
    result.passed++;
  }
}

export class Fuzzer0<R> extends FuzzerBase {
  private generator: ((seed: FuzzSeed, run: () => R) => void) | null = null;
  private returnsBool: bool;

  constructor(
    name: string,
    private callback: () => R,
    skipped: bool = false,
  ) {
    super(name, skipped);
    this.returnsBool = !isVoid<R>();
  }

  generate<T extends Function>(generator: T): this {
    this.generator =
      changetype<(seed: FuzzSeed, run: () => R) => void>(generator);
    return this;
  }

  generateTyped(generator: (seed: FuzzSeed, run: () => R) => void): this {
    this.generator = generator;
    return this;
  }

  run(seedBase: u64, runs: i32): FuzzerResult {
    if (this.skipped) return createSkippedResult(this.name);
    const result = createResult(this.name, runs);
    __fuzz_callback0 = changetype<() => usize>(this.callback);
    __fuzz_returns_bool = this.returnsBool;
    for (let i = 0; i < runs; i++) {
      prepareFuzzIteration();
      __fuzz_calls = 0;
      const seed = new FuzzSeed(seedBase + <u64>i);
      if (this.generator) {
        this.generator(seed, changetype<() => R>(__fuzz_run0));
      } else {
        __fuzz_run0();
      }
      if (__fuzz_calls != 1) {
        failFuzzIteration(
          "generator",
          __fuzz_calls.toString(),
          "1",
          "fuzz generator must call run() exactly once",
        );
      }
      recordResult(result);
    }
    __fuzz_callback0 = null;
    result.timeEnd = performance.now();
    return result;
  }
}

export class Fuzzer1<A, R> extends FuzzerBase {
  private generator: ((seed: FuzzSeed, run: (a: A) => R) => void) | null = null;
  private returnsBool: bool;

  constructor(
    name: string,
    private callback: (a: A) => R,
    skipped: bool = false,
  ) {
    super(name, skipped);
    this.returnsBool = !isVoid<R>();
  }

  generate<T extends Function>(generator: T): this {
    this.generator =
      changetype<(seed: FuzzSeed, run: (a: A) => R) => void>(generator);
    return this;
  }

  generateTyped(generator: (seed: FuzzSeed, run: (a: A) => R) => void): this {
    this.generator = generator;
    return this;
  }

  run(seedBase: u64, runs: i32): FuzzerResult {
    if (this.skipped) return createSkippedResult(this.name);
    const result = createResult(this.name, runs);
    __fuzz_callback1 = changetype<(a: usize) => usize>(this.callback);
    __fuzz_returns_bool = this.returnsBool;
    for (let i = 0; i < runs; i++) {
      prepareFuzzIteration();
      __fuzz_calls = 0;
      const seed = new FuzzSeed(seedBase + <u64>i);
      if (!this.generator) {
        failFuzzIteration(
          "generate",
          "missing",
          "present",
          "fuzzers with arguments must call .generate(...)",
        );
      } else {
        this.generator(seed, changetype<(a: A) => R>(__fuzz_run1));
      }
      if (__fuzz_calls != 1) {
        failFuzzIteration(
          "generator",
          __fuzz_calls.toString(),
          "1",
          "fuzz generator must call run() exactly once",
        );
      }
      recordResult(result);
    }
    __fuzz_callback1 = null;
    result.timeEnd = performance.now();
    return result;
  }
}

export class Fuzzer2<A, B, R> extends FuzzerBase {
  private generator: ((seed: FuzzSeed, run: (a: A, b: B) => R) => void) | null =
    null;
  private returnsBool: bool;

  constructor(
    name: string,
    private callback: (a: A, b: B) => R,
    skipped: bool = false,
  ) {
    super(name, skipped);
    this.returnsBool = !isVoid<R>();
  }

  generate<T extends Function>(generator: T): this {
    this.generator =
      changetype<(seed: FuzzSeed, run: (a: A, b: B) => R) => void>(generator);
    return this;
  }

  generateTyped(
    generator: (seed: FuzzSeed, run: (a: A, b: B) => R) => void,
  ): this {
    this.generator = generator;
    return this;
  }

  run(seedBase: u64, runs: i32): FuzzerResult {
    if (this.skipped) return createSkippedResult(this.name);
    const result = createResult(this.name, runs);
    __fuzz_callback2 = changetype<(a: usize, b: usize) => usize>(this.callback);
    __fuzz_returns_bool = this.returnsBool;
    for (let i = 0; i < runs; i++) {
      prepareFuzzIteration();
      __fuzz_calls = 0;
      const seed = new FuzzSeed(seedBase + <u64>i);
      if (!this.generator) {
        failFuzzIteration(
          "generate",
          "missing",
          "present",
          "fuzzers with arguments must call .generate(...)",
        );
      } else {
        this.generator(seed, changetype<(a: A, b: B) => R>(__fuzz_run2));
      }
      if (__fuzz_calls != 1) {
        failFuzzIteration(
          "generator",
          __fuzz_calls.toString(),
          "1",
          "fuzz generator must call run() exactly once",
        );
      }
      recordResult(result);
    }
    __fuzz_callback2 = null;
    result.timeEnd = performance.now();
    return result;
  }
}

export class Fuzzer3<A, B, C, R> extends FuzzerBase {
  private generator:
    | ((seed: FuzzSeed, run: (a: A, b: B, c: C) => R) => void)
    | null = null;
  private returnsBool: bool;

  constructor(
    name: string,
    private callback: (a: A, b: B, c: C) => R,
    skipped: bool = false,
  ) {
    super(name, skipped);
    this.returnsBool = !isVoid<R>();
  }

  generate<T extends Function>(generator: T): this {
    this.generator =
      changetype<(seed: FuzzSeed, run: (a: A, b: B, c: C) => R) => void>(
        generator,
      );
    return this;
  }

  generateTyped(
    generator: (seed: FuzzSeed, run: (a: A, b: B, c: C) => R) => void,
  ): this {
    this.generator = generator;
    return this;
  }

  run(seedBase: u64, runs: i32): FuzzerResult {
    if (this.skipped) return createSkippedResult(this.name);
    const result = createResult(this.name, runs);
    __fuzz_callback3 = changetype<(a: usize, b: usize, c: usize) => usize>(
      this.callback,
    );
    __fuzz_returns_bool = this.returnsBool;
    for (let i = 0; i < runs; i++) {
      prepareFuzzIteration();
      __fuzz_calls = 0;
      const seed = new FuzzSeed(seedBase + <u64>i);
      if (!this.generator) {
        failFuzzIteration(
          "generate",
          "missing",
          "present",
          "fuzzers with arguments must call .generate(...)",
        );
      } else {
        this.generator(seed, changetype<(a: A, b: B, c: C) => R>(__fuzz_run3));
      }
      if (__fuzz_calls != 1) {
        failFuzzIteration(
          "generator",
          __fuzz_calls.toString(),
          "1",
          "fuzz generator must call run() exactly once",
        );
      }
      recordResult(result);
    }
    __fuzz_callback3 = null;
    result.timeEnd = performance.now();
    return result;
  }
}

export function createFuzzer<T extends Function>(
  name: string,
  callback: T,
  skipped: bool = false,
): FuzzerBase {
  const length = callback.length;
  if (length == 0) {
    return new Fuzzer0<usize>(name, changetype<() => usize>(callback), skipped);
  }
  if (length == 1) {
    return new Fuzzer1<usize, usize>(
      name,
      changetype<(a: usize) => usize>(callback),
      skipped,
    );
  }
  if (length == 2) {
    return new Fuzzer2<usize, usize, usize>(
      name,
      changetype<(a: usize, b: usize) => usize>(callback),
      skipped,
    );
  }
  if (length == 3) {
    return new Fuzzer3<usize, usize, usize, usize>(
      name,
      changetype<(a: usize, b: usize, c: usize) => usize>(callback),
      skipped,
    );
  }
  panic();
  return new Fuzzer0<usize>(name, changetype<() => usize>(callback), skipped);
}

function buildAlphabet(options: StringOptions): i32[] {
  const out = baseAlphabet(options.charset);
  if (options.charset == "custom") {
    out.length = 0;
  }
  for (let i = 0; i < options.include.length; i++) {
    const value = unchecked(options.include[i]);
    if (!out.includes(value)) out.push(value);
  }
  for (let i = 0; i < options.exclude.length; i++) {
    removeFirst(out, unchecked(options.exclude[i]));
  }
  return out;
}

function baseAlphabet(charset: string): i32[] {
  if (charset == "alpha") return rangeChars(65, 90).concat(rangeChars(97, 122));
  if (charset == "alnum")
    return baseAlphabet("alpha").concat(rangeChars(48, 57));
  if (charset == "digit") return rangeChars(48, 57);
  if (charset == "hex") return rangeChars(48, 57).concat(rangeChars(97, 102));
  if (charset == "base64")
    return rangeChars(65, 90)
      .concat(rangeChars(97, 122))
      .concat(rangeChars(48, 57))
      .concat([43, 47, 61]);
  if (charset == "identifier")
    return [95].concat(baseAlphabet("alpha")).concat(rangeChars(48, 57));
  if (charset == "whitespace") return [9, 10, 13, 32];
  if (charset == "custom") return [];
  return rangeChars(32, 126);
}

function rangeChars(start: i32, end: i32): i32[] {
  const out = new Array<i32>();
  for (let value = start; value <= end; value++) {
    out.push(value);
  }
  return out;
}

function removeFirst(values: i32[], needle: i32): void {
  const index = values.indexOf(needle);
  if (index >= 0) values.splice(index, 1);
}

function validateLengthRange(label: string, min: i32, max: i32): void {
  if (min < 0 || max < 0) panic();
  if (max < min) panic();
}

function containsValue<T>(values: T[], needle: T): bool {
  for (let i = 0; i < values.length; i++) {
    if (unchecked(values[i]) == needle) return true;
  }
  return false;
}

function containsFloatValue<T>(values: T[], needle: T): bool {
  const value = <f64>needle;
  for (let i = 0; i < values.length; i++) {
    const candidate = <f64>unchecked(values[i]);
    if (isNaN(value) && isNaN(candidate)) return true;
    if (candidate == value) return true;
  }
  return false;
}

// @ts-ignore
@global export let __as_test_fuzz_failed: bool = false;
// @ts-ignore
@global export let __as_test_fuzz_failure_instr: string = "";
// @ts-ignore
@global export let __as_test_fuzz_failure_left: string = "";
// @ts-ignore
@global export let __as_test_fuzz_failure_right: string = "";
// @ts-ignore
@global export let __as_test_fuzz_failure_message: string = "";

export function prepareFuzzIteration(): void {
  __as_test_fuzz_failed = false;
  __as_test_fuzz_failure_instr = "";
  __as_test_fuzz_failure_left = "";
  __as_test_fuzz_failure_right = "";
  __as_test_fuzz_failure_message = "";
}

export function failFuzzIteration(
  instr: string,
  left: string,
  right: string,
  message: string,
): void {
  __as_test_fuzz_failed = true;
  if (!__as_test_fuzz_failure_instr.length) {
    __as_test_fuzz_failure_instr = instr;
    __as_test_fuzz_failure_left = left;
    __as_test_fuzz_failure_right = right;
    __as_test_fuzz_failure_message = message;
  }
}

function panic(): void {
  unreachable();
}
