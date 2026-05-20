import { visualize } from "../util/helpers";
import { Tests } from "./tests";
import { JSON } from "json-as/assembly";
import { namedSnapshotKey, nextUnnamedSnapshotKey } from "..";
import {
  sendAssertionFailure,
  sendWarning,
  snapshotAssert,
} from "../util/wipc";
import { OBJECT, TOTAL_OVERHEAD } from "~lib/rt/common";

let warnedToThrowDisabled = false;

export class Expectation<T> extends Tests {
  public verdict: string = "none";
  public right: string = "null";
  public left: string = "null";

  private _left: T;

  // @ts-ignore
  private _right: u64 = 0;

  // @ts-ignore
  private _not: boolean = false;

  // @ts-ignore
  private _skip: boolean = false;

  private _message: string = "";

  private _snapshotKey: string = "";

  private _location: string = "";

  constructor(
    left: T,
    message: string = "",
    snapshotKey: string = "",
    location: string = "",
  ) {
    super();
    this._left = left;
    this._message = message;
    this._snapshotKey = snapshotKey;
    this._location = location;
    this.location = location;
  }

  get not(): Expectation<T> {
    this._not = true;
    return this;
  }

  skip(): Expectation<T> {
    this._skip = true;
    return this;
  }

  private _resolve(
    passed: bool,
    instr: string,
    left: string,
    right: string,
    message: string = "",
  ): void {
    if (this._skip) {
      this.verdict = "skip";
      this.instr = instr;
      this.left = left;
      this.right = right;
      this.message = "";
      this._not = false;
      return;
    }
    const isFail = this._not ? passed : !passed;
    this.verdict = isFail ? "fail" : "ok";
    this.instr = instr;
    this.left = left;
    this.right = right;
    const resolvedMessage = message.length ? message : this._message;
    this.message = isFail ? resolvedMessage : "";
    if (isFail) {
      sendAssertionFailure(this._snapshotKey, instr, left, right, this.message);
      // @ts-ignore
      if (isDefined(AS_TEST_FUZZ)) {
        // @ts-ignore
        __as_test_fuzz_failed = true;
        // @ts-ignore
        if (!__as_test_fuzz_failure_instr.length) {
          // @ts-ignore
          __as_test_fuzz_failure_instr = instr;
          // @ts-ignore
          __as_test_fuzz_failure_left = left;
          // @ts-ignore
          __as_test_fuzz_failure_right = right;
          // @ts-ignore
          __as_test_fuzz_failure_message = this.message;
        }
      }
    }
    this._not = false;
  }

  /**
   * Tests if a == null
   */
  toBeNull(message: string = ""): void {
    const passed =
      (isNullable<T>() && changetype<usize>(this._left) == 0) ||
      (isInteger<T>() && nameof<T>() == "usize" && this._left == 0);

    // @ts-ignore
    store<T>(changetype<usize>(this), null, offsetof<Expectation<T>>("_right"));
    this._resolve(
      passed,
      "toBeNull",
      visualize<T>(this._left),
      visualize<T>(
        load<T>(changetype<usize>(this), offsetof<Expectation<T>>("_right")),
      ),
      message,
    );
  }

  /**
   * Tests if a > b
   */
  toBeGreaterThan(value: T, message: string = ""): void {
    if (!isInteger<T>() && !isFloat<T>())
      ERROR("toBeGreaterThan() can only be used on number types!");

    store<T>(
      changetype<usize>(this),
      value,
      offsetof<Expectation<T>>("_right"),
    );
    this._resolve(
      this._left > value,
      "toBeGreaterThan",
      visualize<T>(this._left),
      visualize<T>(
        load<T>(changetype<usize>(this), offsetof<Expectation<T>>("_right")),
      ),
      message,
    );
  }

  /**
   * Tests if a >= b
   */
  toBeGreaterOrEqualTo(value: T, message: string = ""): void {
    if (!isInteger<T>() && !isFloat<T>())
      ERROR("toBeGreaterOrEqualTo() can only be used on number types!");

    store<T>(
      changetype<usize>(this),
      value,
      offsetof<Expectation<T>>("_right"),
    );
    this._resolve(
      this._left >= value,
      "toBeGreaterThanOrEqualTo",
      visualize<T>(this._left),
      visualize<T>(
        load<T>(changetype<usize>(this), offsetof<Expectation<T>>("_right")),
      ),
      message,
    );
  }

  /**
   * Tests if a < b
   */
  toBeLessThan(value: T, message: string = ""): void {
    if (!isInteger<T>() && !isFloat<T>())
      ERROR("toBeLessThan() can only be used on number types!");

    store<T>(
      changetype<usize>(this),
      value,
      offsetof<Expectation<T>>("_right"),
    );
    this._resolve(
      this._left < value,
      "toBeLessThan",
      visualize<T>(this._left),
      visualize<T>(
        load<T>(changetype<usize>(this), offsetof<Expectation<T>>("_right")),
      ),
      message,
    );
  }

  /**
   * Tests if a <= b
   */
  toBeLessThanOrEqualTo(value: T, message: string = ""): void {
    if (!isInteger<T>() && !isFloat<T>())
      ERROR("toBeLessThanOrEqualTo() can only be used on number types!");

    store<T>(
      changetype<usize>(this),
      value,
      offsetof<Expectation<T>>("_right"),
    );
    this._resolve(
      this._left <= value,
      "toBeLessThanOrEqualTo",
      visualize<T>(this._left),
      visualize<T>(
        load<T>(changetype<usize>(this), offsetof<Expectation<T>>("_right")),
      ),
      message,
    );
  }

  /**
   * Tests if a is string
   */
  toBeString(message: string = ""): void {
    this._resolve(
      isString<T>(),
      "toBeString",
      q(nameof<T>()),
      q("string"),
      message,
    );
  }

  /**
   * Tests if a is boolean
   */
  toBeBoolean(message: string = ""): void {
    this._resolve(
      isBoolean<T>(),
      "toBeBoolean",
      q(nameof<T>()),
      q("boolean"),
      message,
    );
  }

  /**
   * Tests if a is array
   */
  toBeArray(message: string = ""): void {
    this._resolve(
      isArray<T>(),
      "toBeArray",
      q(nameof<T>()),
      q("Array<any>"),
      message,
    );
  }

  /**
   * Tests if a is number
   */
  toBeNumber(message: string = ""): void {
    this._resolve(
      isFloat<T>() || isInteger<T>(),
      "toBeNumber",
      q(nameof<T>()),
      q("number"),
      message,
    );
  }

  /**
   * Tests if a is integer
   */
  toBeInteger(message: string = ""): void {
    this._resolve(
      isInteger<T>(),
      "toBeInteger",
      q(nameof<T>()),
      q("integer"),
      message,
    );
  }

  /**
   * Tests if a is float
   */
  toBeFloat(message: string = ""): void {
    this._resolve(
      isFloat<T>(),
      "toBeFloat",
      q(nameof<T>()),
      q("float"),
      message,
    );
  }

  /**
   * Tests if a is finite
   */
  toBeFinite(message: string = ""): void {
    // @ts-ignore
    const passed = (isFloat<T>() || isInteger<T>()) && isFinite(this._left);
    this._resolve(passed, "toBeFinite", q("Infinity"), q("Finite"), message);
  }

  /**
   * Tests if a value is truthy
   */
  toBeTruthy(message: string = ""): void {
    this._resolve(
      isTruthy<T>(this._left),
      "toBeTruthy",
      q("falsy"),
      q("truthy"),
      message,
    );
  }

  /**
   * Tests if a value is falsy
   */
  toBeFalsy(message: string = ""): void {
    this._resolve(
      !isTruthy<T>(this._left),
      "toBeFalsy",
      q("truthy"),
      q("falsy"),
      message,
    );
  }

  /**
   * Tests if a floating-point number is close to expected
   */
  toBeCloseTo(expected: T, precision: i32 = 2, message: string = ""): void {
    if (!isFloat<T>() && !isInteger<T>())
      ERROR("toBeCloseTo() can only be used on number types!");
    const factor = Math.pow(10, precision as f64);
    const delta = Math.abs((this._left as f64) - (expected as f64));
    const passed = delta < 0.5 / factor;
    this._resolve(
      passed,
      "toBeCloseTo",
      visualize<T>(this._left),
      visualize<T>(expected),
      message,
    );
  }

  /**
   * Tests if a string contains substring
   */
  toMatch(value: string, message: string = ""): void {
    if (!isString<T>()) ERROR("toMatch() can only be used on string types!");
    // @ts-ignore
    const passed = this._left.indexOf(value) >= 0;
    // @ts-ignore
    this._resolve(
      passed,
      "toMatch",
      q(this._left as string),
      q(value),
      message,
    );
  }

  /**
   * Tests if a string starts with the provided prefix.
   */
  toStartWith(value: string, message: string = ""): void {
    if (!isString<T>())
      ERROR("toStartWith() can only be used on string types!");
    // @ts-ignore
    const left = this._left as string;
    const passed = left.indexOf(value) == 0;
    this._resolve(passed, "toStartWith", q(left), q(value), message);
  }

  /**
   * Tests if a string ends with the provided suffix.
   */
  toEndWith(value: string, message: string = ""): void {
    if (!isString<T>()) ERROR("toEndWith() can only be used on string types!");
    // @ts-ignore
    const left = this._left as string;
    const idx = left.lastIndexOf(value);
    const passed = idx >= 0 && idx + value.length == left.length;
    this._resolve(passed, "toEndWith", q(left), q(value), message);
  }

  /**
   * Tests if an array has length x
   */
  toHaveLength(value: i32, message: string = ""): void {
    // @ts-ignore
    const leftLen = this._left.length as i32;
    // @ts-ignore
    const passed = isArray<T>() && leftLen == value;
    this._resolve(
      passed,
      "toHaveLength",
      leftLen.toString(),
      value.toString(),
      message,
    );
  }

  /**
   * Tests if an array or string contains a value
   */
  // @ts-ignore
  toContain(value: valueof<T>, message: string = ""): void {
    if (isString<T>()) {
      // @ts-ignore
      const left = this._left as string;
      // @ts-ignore
      const needle = value as string;
      const passed = left.indexOf(needle) >= 0;
      this._resolve(passed, "toContain", q(left), q(needle), message);
      return;
    }

    if (isArray<T>()) {
      // @ts-ignore
      const passed = this._left.includes(value);
      this._resolve(
        passed,
        "toContain",
        JSON.stringify<T>(this._left),
        JSON.stringify<valueof<T>>(value),
        message,
      );
      return;
    }

    ERROR("toContain() can only be used on string and array types!");
  }

  /**
   * Alias for toContain().
   */
  // @ts-ignore
  toContains(value: valueof<T>, message: string = ""): void {
    this.toContain(value, message);
  }

  /**
   * Tests if serialized value matches stored snapshot.
   */
  toMatchSnapshot(name: string = "", message: string = ""): void {
    let key = name.length
      ? namedSnapshotKey(this._snapshotKey, name)
      : nextUnnamedSnapshotKey(this._snapshotKey);

    const actual = JSON.stringify<T>(this._left);
    const res = snapshotAssert(key, actual);
    this._resolve(res.ok, "toMatchSnapshot", actual, res.expected, message);
  }

  /**
   * Invokes the wrapped function inside a try/catch and asserts it threw.
   * Requires the try-as feature (`--enable try-as`).
   *
   *   expect((): void => { throw new Error("boom"); }).toThrow();
   *
   * The value passed to `expect()` must be a `() => void` callback — calling
   * `.toThrow()` on a non-function value records a failure that explains the
   * usage.
   */
  toThrow(message: string = ""): void {
    // @ts-ignore
    if (!isDefined(AS_TEST_TRY_AS)) {
      if (!warnedToThrowDisabled) {
        sendWarning(
          "toThrow() requires the try-as feature. Enable with --enable try-as.",
        );
        warnedToThrowDisabled = true;
      }
      this._resolve(true, "toThrow", q("disabled"), q("disabled"), message);
      return;
    }

    if (!isFunction<T>()) {
      this._resolve(
        false,
        "toThrow",
        q("non-function"),
        q("() => void"),
        message.length
          ? message
          : "toThrow() requires a function: expect((): void => { ... }).toThrow()",
      );
      return;
    }

    // try-as rewrites the throw inside the callback to bump
    // __ExceptionState.Failures and return early from the arrow. We never
    // wrap the call in try/catch here because try-as's source linker does not
    // follow chained method calls (`expect(...).toThrow()`) and so it would
    // not rewrite a `try` placed in this method body. Compare the failure
    // counter before/after instead and consume any failure we observed.
    // @ts-ignore: __ExceptionState is provided by the try-as transform
    const beforeFailures = __ExceptionState.Failures;
    // @ts-ignore: guarded by isFunction<T>() above
    (this._left as () => void)();
    // @ts-ignore
    const threw = __ExceptionState.Failures > beforeFailures;
    if (threw) {
      // @ts-ignore
      __ExceptionState.Failures = beforeFailures;
    }
    this._resolve(
      threw,
      "toThrow",
      q(threw ? "threw" : "did not throw"),
      q("throws"),
      message,
    );
  }

  /**
   * Tests for equality
   */
  toBe(equals: T, message: string = ""): void {
    const passed = this._left === equals;

    this._resolve(
      passed,
      "toBe",
      JSON.stringify<T>(this._left),
      JSON.stringify<T>(equals),
      message,
    );
  }

  /**
   * Tests for deep equality
   */
  toEqual(equals: T, message: string = ""): void {
    const passed = valueEquals<T>(this._left, equals, false);
    this._resolve(
      passed,
      "toEqual",
      JSON.stringify<T>(this._left),
      JSON.stringify<T>(equals),
      message,
    );
  }

  /**
   * Tests for strict deep equality
   */
  toStrictEqual(equals: T, message: string = ""): void {
    const passed = valueEquals<T>(this._left, equals, true);
    this._resolve(
      passed,
      "toStrictEqual",
      JSON.stringify<T>(this._left),
      JSON.stringify<T>(equals),
      message,
    );
  }
}

function arrayEquals<T>(a: T[], b: T[], strict: bool): boolean {
  if (a.length != b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!valueEquals<T>(unchecked(a[i]), unchecked(b[i]), strict)) {
      return false;
    }
  }
  return true;
}

function valueEquals<T>(left: T, right: T, strict: bool): bool {
  if (isBoolean<T>() || isString<T>() || isInteger<T>() || isFloat<T>()) {
    return left === right;
  }

  if (isNullable<T>()) {
    const leftPtr = changetype<usize>(left);
    const rightPtr = changetype<usize>(right);
    if (leftPtr == 0 || rightPtr == 0) return leftPtr == rightPtr;
  }

  if (isArray<T>()) {
    return arrayEquals<valueof<T>>(
      changetype<valueof<T>[]>(left),
      changetype<valueof<T>[]>(right),
      strict,
    );
  }

  if (isManaged<T>()) {
    return managedEquals<T>(left, right, strict);
  }

  abort(
    `Unsupported equality matcher for ${nameof<T>()}. Use toBe() for identity or compare fields explicitly.`,
  );
  return false;
}

export function __as_test_deep_equal<T>(left: T, right: T, strict: bool): bool {
  return valueEquals<T>(left, right, strict);
}

function managedEquals<T>(left: T, right: T, strict: bool): bool {
  const leftPtr = changetype<usize>(left);
  const rightPtr = changetype<usize>(right);
  if (leftPtr == rightPtr) return true;
  if (leftPtr == 0 || rightPtr == 0) return false;

  if (strict) {
    const leftObject = changetype<OBJECT>(leftPtr - TOTAL_OVERHEAD);
    const rightObject = changetype<OBJECT>(rightPtr - TOTAL_OVERHEAD);
    if (leftObject.rtId != rightObject.rtId) return false;
  }

  // @ts-ignore
  return left.__as_test_equals(right, strict);
}

function isTruthy<T>(value: T): bool {
  if (isBoolean<T>()) {
    return value as bool;
  }
  if (isString<T>()) {
    // @ts-ignore
    return (value as string).length > 0;
  }
  if (isInteger<T>()) {
    return value != 0;
  }
  if (isFloat<T>()) {
    return value != 0.0 && !isNaN(value as f64);
  }
  if (isNullable<T>()) {
    return changetype<usize>(value) != 0;
  }
  return true;
}

function q(value: string): string {
  return JSON.stringify<string>(value);
}
