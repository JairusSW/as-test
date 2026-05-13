import { quote, rawOrNull, stringifyValue } from "../util/json";

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

const DEFAULT_F32_OPTIONS = new FloatOptions<f32>();
const DEFAULT_F64_OPTIONS = new FloatOptions<f64>();
const DEFAULT_STRING_OPTIONS = new StringOptions();
const DEFAULT_BYTES_OPTIONS = new BytesOptions();
const DEFAULT_ARRAY_OPTIONS = new ArrayOptions();
const I64_SIGN_MASK: u64 = 0x8000000000000000;
const EMPTY_I8_EXCLUDE: i8[] = [];
const EMPTY_U8_EXCLUDE: u8[] = [];
const EMPTY_I16_EXCLUDE: i16[] = [];
const EMPTY_U16_EXCLUDE: u16[] = [];
const EMPTY_I32_EXCLUDE: i32[] = [];
const EMPTY_U32_EXCLUDE: u32[] = [];
const EMPTY_I64_EXCLUDE: i64[] = [];
const EMPTY_U64_EXCLUDE: u64[] = [];

export class FuzzSeed {
  private state: u32;

  constructor(seed: u64) {
    this.reseed(seed);
  }

  reseed(seed: u64): void {
    const lo = <u32>seed;
    const hi = <u32>(seed >> 32);
    let mixed = lo ^ (hi * 0x9e3779b9) ^ 0xa341316c;
    if (mixed == 0) mixed = 0x6d2b79f5;
    this.state = mixed;
  }

  boolean(): bool {
    return (this.nextU32() & 1) == 1;
  }

  bool(): bool {
    return this.boolean();
  }

  pick<T>(values: T[]): T {
    if (!values.length) panic();
    return unchecked(values[this.nextRange(0, values.length - 1)]);
  }

  i8(options: IntegerOptions<i8> | null = null): i8 {
    if (options == null) {
      return this.nextI8InRange(
        i8.MIN_VALUE,
        i8.MAX_VALUE,
        EMPTY_I8_EXCLUDE,
        false,
      );
    }
    return this.nextI8InRange(options.min, options.max, options.exclude, true);
  }

  u8(options: IntegerOptions<u8> | null = null): u8 {
    if (options == null) {
      return this.nextU8InRange(
        u8.MIN_VALUE,
        u8.MAX_VALUE,
        EMPTY_U8_EXCLUDE,
        false,
      );
    }
    return this.nextU8InRange(options.min, options.max, options.exclude, true);
  }

  i16(options: IntegerOptions<i16> | null = null): i16 {
    if (options == null) {
      return this.nextI16InRange(
        i16.MIN_VALUE,
        i16.MAX_VALUE,
        EMPTY_I16_EXCLUDE,
        false,
      );
    }
    return this.nextI16InRange(options.min, options.max, options.exclude, true);
  }

  u16(options: IntegerOptions<u16> | null = null): u16 {
    if (options == null) {
      return this.nextU16InRange(
        u16.MIN_VALUE,
        u16.MAX_VALUE,
        EMPTY_U16_EXCLUDE,
        false,
      );
    }
    return this.nextU16InRange(options.min, options.max, options.exclude, true);
  }

  i32(options: IntegerOptions<i32> | null = null): i32 {
    if (options == null) {
      return this.nextI32InRange(
        i32.MIN_VALUE,
        i32.MAX_VALUE,
        EMPTY_I32_EXCLUDE,
        false,
      );
    }
    return this.nextI32InRange(options.min, options.max, options.exclude, true);
  }

  u32(options: IntegerOptions<u32> | null = null): u32 {
    if (options == null) {
      return this.nextU32InRange(
        u32.MIN_VALUE,
        u32.MAX_VALUE,
        EMPTY_U32_EXCLUDE,
        false,
      );
    }
    return this.nextU32InRange(options.min, options.max, options.exclude, true);
  }

  i64(options: IntegerOptions<i64> | null = null): i64 {
    if (options == null) {
      return this.nextI64InRange(
        i64.MIN_VALUE,
        i64.MAX_VALUE,
        EMPTY_I64_EXCLUDE,
        false,
      );
    }
    return this.nextI64InRange(options.min, options.max, options.exclude, true);
  }

  u64(options: IntegerOptions<u64> | null = null): u64 {
    if (options == null) {
      return this.nextU64InRange(
        u64.MIN_VALUE,
        u64.MAX_VALUE,
        EMPTY_U64_EXCLUDE,
        false,
      );
    }
    return this.nextU64InRange(options.min, options.max, options.exclude, true);
  }

  f32(options: FloatOptions<f32> | null = null): f32 {
    const config = options != null ? options : DEFAULT_F32_OPTIONS;
    return <f32>(
      this.nextF64InRange<f32>(config.min, config.max, config.exclude)
    );
  }

  f64(options: FloatOptions<f64> | null = null): f64 {
    const config = options != null ? options : DEFAULT_F64_OPTIONS;
    return this.nextF64InRange<f64>(config.min, config.max, config.exclude);
  }

  bytes(options: BytesOptions | null = null): Uint8Array {
    const config = options != null ? options : DEFAULT_BYTES_OPTIONS;
    validateLengthRange("seed.bytes()", config.min, config.max);
    const length = this.nextRange(config.min, config.max);
    const out = new Uint8Array(length);
    const include = config.include;
    const exclude = config.exclude;
    if (include.length) {
      if (!exclude.length) {
        for (let i = 0; i < length; i++) {
          unchecked(
            (out[i] = <u8>(
              unchecked(include[this.nextRange(0, include.length - 1)])
            )),
          );
        }
        return out;
      }
      for (let i = 0; i < length; i++) {
        unchecked((out[i] = this.byteFromOptions(config)));
      }
      return out;
    }
    if (!exclude.length) {
      for (let i = 0; i < length; i++) {
        unchecked((out[i] = <u8>(this.nextU32() & 0xff)));
      }
      return out;
    }
    for (let i = 0; i < length; i++) {
      unchecked((out[i] = this.byteFromOptions(config)));
    }
    return out;
  }

  buffer(options: BytesOptions | null = null): ArrayBuffer {
    return this.bytes(options).buffer;
  }

  string(options: StringOptions | null = null): string {
    const config = options != null ? options : DEFAULT_STRING_OPTIONS;
    validateLengthRange("seed.string()", config.min, config.max);
    const alphabet = buildAlphabet(config);
    if (!alphabet.length) {
      panic();
    }
    const coreLength = this.nextRange(config.min, config.max);
    const prefixLength = config.prefix.length;
    const suffixLength = config.suffix.length;
    const totalLength = prefixLength + coreLength + suffixLength;
    if (!totalLength) return "";

    // Allocate UTF-16 payload directly and fill code units in one pass.
    const outPtr = __new(<usize>(totalLength << 1), idof<string>());
    let cursor: usize = outPtr;

    for (let i = 0; i < prefixLength; i++) {
      store<u16>(cursor, <u16>config.prefix.charCodeAt(i));
      cursor += 2;
    }

    const last = alphabet.length - 1;
    for (let i = 0; i < coreLength; i++) {
      store<u16>(cursor, <u16>unchecked(alphabet[this.nextRange(0, last)]));
      cursor += 2;
    }

    for (let i = 0; i < suffixLength; i++) {
      store<u16>(cursor, <u16>config.suffix.charCodeAt(i));
      cursor += 2;
    }

    return changetype<string>(outPtr);
  }

  array<T>(
    item: (seed: FuzzSeed) => T,
    options: ArrayOptions | null = null,
  ): Array<T> {
    const config = options != null ? options : DEFAULT_ARRAY_OPTIONS;
    validateLengthRange("seed.array()", config.min, config.max);
    const length = this.nextRange(config.min, config.max);
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
      if (!exclude.length) {
        return <u8>unchecked(include[this.nextRange(0, include.length - 1)]);
      }
      for (let attempts = 0; attempts < 1024; attempts++) {
        const picked = unchecked(
          include[this.nextRange(0, include.length - 1)],
        );
        if (!containsValue<u8>(exclude, picked)) return picked;
      }
      panic();
    }
    if (!exclude.length) {
      return <u8>(this.nextU32() & 0xff);
    }
    for (let attempts = 0; attempts < 1024; attempts++) {
      const value = <u8>(this.nextU32() & 0xff);
      if (!containsValue<u8>(exclude, value)) return value;
    }
    panic();
    return 0;
  }

  private nextI32InRange(
    min: i32,
    max: i32,
    exclude: i32[],
    validateRange: bool = true,
  ): i32 {
    if (validateRange && max < min) panic();
    if (!validateRange && min == i32.MIN_VALUE && max == i32.MAX_VALUE) {
      return <i32>this.nextU32();
    }
    if (!exclude.length) {
      return max <= min
        ? min
        : min + <i32>(this.nextU32() % <u32>(max - min + 1));
    }
    for (let attempts = 0; attempts < 1024; attempts++) {
      const value =
        max <= min ? min : min + <i32>(this.nextU32() % <u32>(max - min + 1));
      if (!containsValue<i32>(exclude, value)) return value;
    }
    panic();
    return min;
  }

  private nextI8InRange(
    min: i8,
    max: i8,
    exclude: i8[],
    validateRange: bool = true,
  ): i8 {
    if (validateRange && max < min) panic();
    if (!validateRange && min == i8.MIN_VALUE && max == i8.MAX_VALUE) {
      return <i8>this.nextU32();
    }
    const left = <i32>min;
    const right = <i32>max;
    if (!exclude.length) {
      return <i8>(
        (right <= left
          ? left
          : left + <i32>(this.nextU32() % <u32>(right - left + 1)))
      );
    }
    for (let attempts = 0; attempts < 1024; attempts++) {
      const value = <i8>(
        (right <= left
          ? left
          : left + <i32>(this.nextU32() % <u32>(right - left + 1)))
      );
      if (!containsValue<i8>(exclude, value)) return value;
    }
    panic();
    return min;
  }

  private nextU8InRange(
    min: u8,
    max: u8,
    exclude: u8[],
    validateRange: bool = true,
  ): u8 {
    if (validateRange && max < min) panic();
    if (!validateRange && min == u8.MIN_VALUE && max == u8.MAX_VALUE) {
      return <u8>this.nextU32();
    }
    const left = <u32>min;
    const right = <u32>max;
    if (!exclude.length) {
      return <u8>(
        (right <= left ? left : left + (this.nextU32() % (right - left + 1)))
      );
    }
    for (let attempts = 0; attempts < 1024; attempts++) {
      const value = <u8>(
        (right <= left ? left : left + (this.nextU32() % (right - left + 1)))
      );
      if (!containsValue<u8>(exclude, value)) return value;
    }
    panic();
    return min;
  }

  private nextI16InRange(
    min: i16,
    max: i16,
    exclude: i16[],
    validateRange: bool = true,
  ): i16 {
    if (validateRange && max < min) panic();
    if (!validateRange && min == i16.MIN_VALUE && max == i16.MAX_VALUE) {
      return <i16>this.nextU32();
    }
    const left = <i32>min;
    const right = <i32>max;
    if (!exclude.length) {
      return <i16>(
        (right <= left
          ? left
          : left + <i32>(this.nextU32() % <u32>(right - left + 1)))
      );
    }
    for (let attempts = 0; attempts < 1024; attempts++) {
      const value = <i16>(
        (right <= left
          ? left
          : left + <i32>(this.nextU32() % <u32>(right - left + 1)))
      );
      if (!containsValue<i16>(exclude, value)) return value;
    }
    panic();
    return min;
  }

  private nextU16InRange(
    min: u16,
    max: u16,
    exclude: u16[],
    validateRange: bool = true,
  ): u16 {
    if (validateRange && max < min) panic();
    if (!validateRange && min == u16.MIN_VALUE && max == u16.MAX_VALUE) {
      return <u16>this.nextU32();
    }
    const left = <u32>min;
    const right = <u32>max;
    if (!exclude.length) {
      return <u16>(
        (right <= left ? left : left + (this.nextU32() % (right - left + 1)))
      );
    }
    for (let attempts = 0; attempts < 1024; attempts++) {
      const value = <u16>(
        (right <= left ? left : left + (this.nextU32() % (right - left + 1)))
      );
      if (!containsValue<u16>(exclude, value)) return value;
    }
    panic();
    return min;
  }

  private nextU32InRange(
    min: u32,
    max: u32,
    exclude: u32[],
    validateRange: bool = true,
  ): u32 {
    if (validateRange && max < min) panic();
    if (!validateRange && min == u32.MIN_VALUE && max == u32.MAX_VALUE) {
      return this.nextU32();
    }
    if (!exclude.length) {
      return max <= min ? min : min + (this.nextU32() % (max - min + 1));
    }
    for (let attempts = 0; attempts < 1024; attempts++) {
      const value = max <= min ? min : min + (this.nextU32() % (max - min + 1));
      if (!containsValue<u32>(exclude, value)) return value;
    }
    panic();
    return min;
  }

  private nextI64InRange(
    min: i64,
    max: i64,
    exclude: i64[],
    validateRange: bool = true,
  ): i64 {
    if (validateRange && max < min) panic();
    if (!validateRange && min == i64.MIN_VALUE && max == i64.MAX_VALUE) {
      return <i64>this.nextU64();
    }
    const left = this.toOrderedU64(min);
    const right = this.toOrderedU64(max);
    if (!exclude.length) {
      return this.fromOrderedU64(left + this.nextU64Offset(left, right));
    }
    for (let attempts = 0; attempts < 1024; attempts++) {
      const value = this.fromOrderedU64(left + this.nextU64Offset(left, right));
      if (!containsValue<i64>(exclude, value)) return value;
    }
    panic();
    return min;
  }

  private nextU64InRange(
    min: u64,
    max: u64,
    exclude: u64[],
    validateRange: bool = true,
  ): u64 {
    if (validateRange && max < min) panic();
    if (!validateRange && min == u64.MIN_VALUE && max == u64.MAX_VALUE) {
      return this.nextU64();
    }
    if (!exclude.length) {
      return min + this.nextU64Offset(min, max);
    }
    for (let attempts = 0; attempts < 1024; attempts++) {
      const value = min + this.nextU64Offset(min, max);
      if (!containsValue<u64>(exclude, value)) return value;
    }
    panic();
    return min;
  }

  private nextF64InRange<T>(min: T, max: T, exclude: T[]): f64 {
    const left = <f64>min;
    const right = <f64>max;
    if (right < left) panic();
    if (!exclude.length) {
      return left + (right - left) * this.nextUnit();
    }
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
    // mulberry32: very fast integer-only PRNG suitable for fuzz input generation.
    let x = this.state;
    x += 0x6d2b79f5;
    this.state = x;
    let z = x;
    z = <u32>Math.imul(z ^ (z >> 15), z | 1);
    z ^= z + <u32>Math.imul(z ^ (z >> 7), z | 61);
    return z ^ (z >> 14);
  }

  private nextU64(): u64 {
    const hi = <u64>this.nextU32();
    const lo = <u64>this.nextU32();
    return (hi << 32) | lo;
  }

  private nextU64Offset(min: u64, max: u64): u64 {
    if (max <= min) return 0;
    if (min == 0 && max == u64.MAX_VALUE) return this.nextU64();
    return this.nextU64() % (max - min + 1);
  }

  private toOrderedU64(value: i64): u64 {
    return (<u64>value) ^ I64_SIGN_MASK;
  }

  private fromOrderedU64(value: u64): i64 {
    return <i64>(value ^ I64_SIGN_MASK);
  }
}

const ASCII_ALPHABET: i32[] = rangeChars(32, 126);
const ALPHA_ALPHABET: i32[] = rangeChars(65, 90).concat(rangeChars(97, 122));
const DIGIT_ALPHABET: i32[] = rangeChars(48, 57);
const HEX_ALPHABET: i32[] = DIGIT_ALPHABET.concat(rangeChars(97, 102));
const ALNUM_ALPHABET: i32[] = ALPHA_ALPHABET.concat(DIGIT_ALPHABET);
const BASE64_ALPHABET: i32[] = ALPHA_ALPHABET.concat(DIGIT_ALPHABET).concat([
  43, 47, 61,
]);
const IDENTIFIER_ALPHABET: i32[] = [95]
  .concat(ALPHA_ALPHABET)
  .concat(DIGIT_ALPHABET);
const WHITESPACE_ALPHABET: i32[] = [9, 10, 13, 32];

export abstract class FuzzerBase {
  public name: string;
  public skipped: bool;
  public operations: i32;
  constructor(name: string, skipped: bool = false, operations: i32 = 0) {
    this.name = name;
    this.skipped = skipped;
    this.operations = operations > 0 ? operations : 0;
  }

  generate<T extends Function>(_generator: T, operations: i32 = 0): this {
    if (operations > 0) this.operations = operations;
    return this;
  }

  runsOr(defaultRuns: i32): i32 {
    return this.operations > 0 ? this.operations : defaultRuns;
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
  public failures: FuzzFailure[] = [];

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
      '},"failures":' +
      serializeFuzzFailures(this.failures) +
      "}"
    );
  }
}

export class FuzzFailure {
  public run: i32 = 0;
  public seed: u64 = 0;
  public input: string = "";

  serialize(): string {
    return (
      '{"run":' +
      this.run.toString() +
      ',"seed":' +
      this.seed.toString() +
      ',"input":' +
      rawOrNull(this.input) +
      "}"
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

function recordResult(result: FuzzerResult, run: i32, seed: u64): void {
  if (__as_test_fuzz_failed) {
    result.failed++;
    if (!result.failureInstr.length && __as_test_fuzz_failure_instr.length) {
      result.failureInstr = __as_test_fuzz_failure_instr;
      result.failureLeft = __as_test_fuzz_failure_left;
      result.failureRight = __as_test_fuzz_failure_right;
      result.failureMessage = __as_test_fuzz_failure_message;
    }
    const failure = new FuzzFailure();
    failure.run = run;
    failure.seed = seed;
    failure.input = __as_test_fuzz_input;
    result.failures.push(failure);
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
    operations: i32 = 0,
  ) {
    super(name, skipped, operations);
    this.returnsBool = !isVoid<R>();
  }

  generate<T extends Function>(generator: T, operations: i32 = 0): this {
    this.generator =
      changetype<(seed: FuzzSeed, run: () => R) => void>(generator);
    if (operations > 0) this.operations = operations;
    return this;
  }

  generateTyped(
    generator: (seed: FuzzSeed, run: () => R) => void,
    operations: i32 = 0,
  ): this {
    this.generator = generator;
    if (operations > 0) this.operations = operations;
    return this;
  }

  run(seedBase: u64, runs: i32): FuzzerResult {
    if (this.skipped) return createSkippedResult(this.name);
    const result = createResult(this.name, runs);
    const seed = new FuzzSeed(seedBase);
    __fuzz_callback0 = changetype<() => usize>(this.callback);
    __fuzz_returns_bool = this.returnsBool;
    for (let i = 0; i < runs; i++) {
      prepareFuzzIteration();
      __fuzz_calls = 0;
      seed.reseed(seedBase + <u64>i);
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
      recordResult(result, i, seedBase + <u64>i);
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
    operations: i32 = 0,
  ) {
    super(name, skipped, operations);
    this.returnsBool = !isVoid<R>();
  }

  generate<T extends Function>(generator: T, operations: i32 = 0): this {
    this.generator =
      changetype<(seed: FuzzSeed, run: (a: A) => R) => void>(generator);
    if (operations > 0) this.operations = operations;
    return this;
  }

  generateTyped(
    generator: (seed: FuzzSeed, run: (a: A) => R) => void,
    operations: i32 = 0,
  ): this {
    this.generator = generator;
    if (operations > 0) this.operations = operations;
    return this;
  }

  run(seedBase: u64, runs: i32): FuzzerResult {
    if (this.skipped) return createSkippedResult(this.name);
    const result = createResult(this.name, runs);
    const seed = new FuzzSeed(seedBase);
    __fuzz_callback1 = changetype<(a: usize) => usize>(this.callback);
    __fuzz_returns_bool = this.returnsBool;
    for (let i = 0; i < runs; i++) {
      prepareFuzzIteration();
      __fuzz_calls = 0;
      seed.reseed(seedBase + <u64>i);
      if (!this.generator) {
        failFuzzIteration(
          "generate",
          "missing",
          "present",
          "fuzzers with arguments must call .generate(...)",
        );
      } else {
        this.generator(seed, (a: A): R => {
          __as_test_fuzz_input = "[" + stringifyValue<A>(a) + "]";
          return changetype<(a: A) => R>(__fuzz_run1)(a);
        });
      }
      if (__fuzz_calls != 1) {
        failFuzzIteration(
          "generator",
          __fuzz_calls.toString(),
          "1",
          "fuzz generator must call run() exactly once",
        );
      }
      recordResult(result, i, seedBase + <u64>i);
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
    operations: i32 = 0,
  ) {
    super(name, skipped, operations);
    this.returnsBool = !isVoid<R>();
  }

  generate<T extends Function>(generator: T, operations: i32 = 0): this {
    this.generator =
      changetype<(seed: FuzzSeed, run: (a: A, b: B) => R) => void>(generator);
    if (operations > 0) this.operations = operations;
    return this;
  }

  generateTyped(
    generator: (seed: FuzzSeed, run: (a: A, b: B) => R) => void,
    operations: i32 = 0,
  ): this {
    this.generator = generator;
    if (operations > 0) this.operations = operations;
    return this;
  }

  run(seedBase: u64, runs: i32): FuzzerResult {
    if (this.skipped) return createSkippedResult(this.name);
    const result = createResult(this.name, runs);
    const seed = new FuzzSeed(seedBase);
    __fuzz_callback2 = changetype<(a: usize, b: usize) => usize>(this.callback);
    __fuzz_returns_bool = this.returnsBool;
    for (let i = 0; i < runs; i++) {
      prepareFuzzIteration();
      __fuzz_calls = 0;
      seed.reseed(seedBase + <u64>i);
      if (!this.generator) {
        failFuzzIteration(
          "generate",
          "missing",
          "present",
          "fuzzers with arguments must call .generate(...)",
        );
      } else {
        this.generator(seed, (a: A, b: B): R => {
          __as_test_fuzz_input =
            "[" + stringifyValue<A>(a) + "," + stringifyValue<B>(b) + "]";
          return changetype<(a: A, b: B) => R>(__fuzz_run2)(a, b);
        });
      }
      if (__fuzz_calls != 1) {
        failFuzzIteration(
          "generator",
          __fuzz_calls.toString(),
          "1",
          "fuzz generator must call run() exactly once",
        );
      }
      recordResult(result, i, seedBase + <u64>i);
    }
    __fuzz_callback2 = null;
    result.timeEnd = performance.now();
    return result;
  }
}

export class Fuzzer3<A, B, C, R> extends FuzzerBase {
  private generator: usize = 0;
  private returnsBool: bool;

  constructor(
    name: string,
    private callback: (a: A, b: B, c: C) => R,
    skipped: bool = false,
    operations: i32 = 0,
  ) {
    super(name, skipped, operations);
    this.returnsBool = !isVoid<R>();
  }

  generate<T extends Function>(generator: T, operations: i32 = 0): this {
    this.generator = changetype<usize>(generator);
    if (operations > 0) this.operations = operations;
    return this;
  }

  generateTyped(
    generator: (seed: FuzzSeed, run: (a: A, b: B, c: C) => R) => void,
    operations: i32 = 0,
  ): this {
    this.generator = changetype<usize>(generator);
    if (operations > 0) this.operations = operations;
    return this;
  }

  run(seedBase: u64, runs: i32): FuzzerResult {
    if (this.skipped) return createSkippedResult(this.name);
    const result = createResult(this.name, runs);
    const seed = new FuzzSeed(seedBase);
    __fuzz_callback3 = changetype<(a: usize, b: usize, c: usize) => usize>(
      this.callback,
    );
    __fuzz_returns_bool = this.returnsBool;
    for (let i = 0; i < runs; i++) {
      prepareFuzzIteration();
      __fuzz_calls = 0;
      seed.reseed(seedBase + <u64>i);
      if (!this.generator) {
        failFuzzIteration(
          "generate",
          "missing",
          "present",
          "fuzzers with arguments must call .generate(...)",
        );
      } else {
        changetype<(seed: FuzzSeed, run: (a: A, b: B, c: C) => R) => void>(
          this.generator,
        )(seed, (a: A, b: B, c: C): R => {
          __as_test_fuzz_input =
            "[" +
            stringifyValue<A>(a) +
            "," +
            stringifyValue<B>(b) +
            "," +
            stringifyValue<C>(c) +
            "]";
          return changetype<(a: A, b: B, c: C) => R>(__fuzz_run3)(a, b, c);
        });
      }
      if (__fuzz_calls != 1) {
        failFuzzIteration(
          "generator",
          __fuzz_calls.toString(),
          "1",
          "fuzz generator must call run() exactly once",
        );
      }
      recordResult(result, i, seedBase + <u64>i);
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
  operations: i32 = 0,
): FuzzerBase {
  const length = callback.length;
  if (length == 0) {
    return new Fuzzer0<usize>(
      name,
      changetype<() => usize>(callback),
      skipped,
      operations,
    );
  }
  if (length == 1) {
    return new Fuzzer1<usize, usize>(
      name,
      changetype<(a: usize) => usize>(callback),
      skipped,
      operations,
    );
  }
  if (length == 2) {
    return new Fuzzer2<usize, usize, usize>(
      name,
      changetype<(a: usize, b: usize) => usize>(callback),
      skipped,
      operations,
    );
  }
  if (length == 3) {
    return new Fuzzer3<usize, usize, usize, usize>(
      name,
      changetype<(a: usize, b: usize, c: usize) => usize>(callback),
      skipped,
      operations,
    );
  }
  panic();
  return new Fuzzer0<usize>(
    name,
    changetype<() => usize>(callback),
    skipped,
    operations,
  );
}

function buildAlphabet(options: StringOptions): i32[] {
  if (!options.include.length && !options.exclude.length) {
    return baseAlphabet(options.charset);
  }
  const out = baseAlphabet(options.charset).slice(0);
  for (let i = 0; i < options.include.length; i++) {
    const value = unchecked(options.include[i]);
    if (!containsValue<i32>(out, value)) out.push(value);
  }
  for (let i = 0; i < options.exclude.length; i++) {
    removeFirst(out, unchecked(options.exclude[i]));
  }
  return out;
}

function baseAlphabet(charset: string): i32[] {
  if (charset == "alpha") return ALPHA_ALPHABET;
  if (charset == "alnum") return ALNUM_ALPHABET;
  if (charset == "digit") return DIGIT_ALPHABET;
  if (charset == "hex") return HEX_ALPHABET;
  if (charset == "base64") return BASE64_ALPHABET;
  if (charset == "identifier") return IDENTIFIER_ALPHABET;
  if (charset == "whitespace") return WHITESPACE_ALPHABET;
  if (charset == "custom") return [];
  return ASCII_ALPHABET;
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
// @ts-ignore
@global export let __as_test_fuzz_input: string = "";

export function prepareFuzzIteration(): void {
  __as_test_fuzz_failed = false;
  __as_test_fuzz_failure_instr = "";
  __as_test_fuzz_failure_left = "";
  __as_test_fuzz_failure_right = "";
  __as_test_fuzz_failure_message = "";
  __as_test_fuzz_input = "[]";
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

function serializeFuzzFailures(values: FuzzFailure[]): string {
  if (!values.length) return "[]";

  let out = "[";
  for (let i = 0; i < values.length; i++) {
    if (i) out += ",";
    out += unchecked(values[i]).serialize();
  }
  out += "]";
  return out;
}
