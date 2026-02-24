import { visualize } from "../util/helpers";
import { Tests } from "./tests";
import { quote, stringifyValue } from "../util/json";
import {
  sendAssertionFailure,
  sendWarning,
  snapshotAssert,
} from "../util/wipc";

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
    this.message = isFail ? this._message : "";
    if (isFail) {
      sendAssertionFailure(this._snapshotKey, instr, left, right, this.message);
    }
    this._not = false;
  }

  /**
   * Tests if a == null
   */
  toBeNull(): void {
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
    );
  }

  /**
   * Tests if a > b
   */
  toBeGreaterThan(value: T): void {
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
    );
  }

  /**
   * Tests if a >= b
   */
  toBeGreaterOrEqualTo(value: T): void {
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
    );
  }

  /**
   * Tests if a < b
   */
  toBeLessThan(value: T): void {
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
    );
  }

  /**
   * Tests if a <= b
   */
  toBeLessThanOrEqualTo(value: T): void {
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
    );
  }

  /**
   * Tests if a is string
   */
  toBeString(): void {
    this._resolve(isString<T>(), "toBeString", q(nameof<T>()), q("string"));
  }

  /**
   * Tests if a is boolean
   */
  toBeBoolean(): void {
    this._resolve(isBoolean<T>(), "toBeBoolean", q(nameof<T>()), q("boolean"));
  }

  /**
   * Tests if a is array
   */
  toBeArray(): void {
    this._resolve(isArray<T>(), "toBeArray", q(nameof<T>()), q("Array<any>"));
  }

  /**
   * Tests if a is number
   */
  toBeNumber(): void {
    this._resolve(
      isFloat<T>() || isInteger<T>(),
      "toBeNumber",
      q(nameof<T>()),
      q("number"),
    );
  }

  /**
   * Tests if a is integer
   */
  toBeInteger(): void {
    this._resolve(isInteger<T>(), "toBeInteger", q(nameof<T>()), q("integer"));
  }

  /**
   * Tests if a is float
   */
  toBeFloat(): void {
    this._resolve(isFloat<T>(), "toBeFloat", q(nameof<T>()), q("float"));
  }

  /**
   * Tests if a is finite
   */
  toBeFinite(): void {
    // @ts-ignore
    const passed = (isFloat<T>() || isInteger<T>()) && isFinite(this._left);
    this._resolve(passed, "toBeFinite", q("Infinity"), q("Finite"));
  }

  /**
   * Tests if a value is truthy
   */
  toBeTruthy(): void {
    this._resolve(
      isTruthy<T>(this._left),
      "toBeTruthy",
      q("falsy"),
      q("truthy"),
    );
  }

  /**
   * Tests if a value is falsy
   */
  toBeFalsy(): void {
    this._resolve(
      !isTruthy<T>(this._left),
      "toBeFalsy",
      q("truthy"),
      q("falsy"),
    );
  }

  /**
   * Tests if a floating-point number is close to expected
   */
  toBeCloseTo(expected: T, precision: i32 = 2): void {
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
    );
  }

  /**
   * Tests if a string contains substring
   */
  toMatch(value: string): void {
    if (!isString<T>()) ERROR("toMatch() can only be used on string types!");
    // @ts-ignore
    const passed = this._left.indexOf(value) >= 0;
    // @ts-ignore
    this._resolve(passed, "toMatch", q(this._left as string), q(value));
  }

  /**
   * Tests if a string starts with the provided prefix.
   */
  toStartWith(value: string): void {
    if (!isString<T>())
      ERROR("toStartWith() can only be used on string types!");
    // @ts-ignore
    const left = this._left as string;
    const passed = left.indexOf(value) == 0;
    this._resolve(passed, "toStartWith", q(left), q(value));
  }

  /**
   * Tests if a string ends with the provided suffix.
   */
  toEndWith(value: string): void {
    if (!isString<T>()) ERROR("toEndWith() can only be used on string types!");
    // @ts-ignore
    const left = this._left as string;
    const idx = left.lastIndexOf(value);
    const passed = idx >= 0 && idx + value.length == left.length;
    this._resolve(passed, "toEndWith", q(left), q(value));
  }

  /**
   * Tests if an array has length x
   */
  toHaveLength(value: i32): void {
    // @ts-ignore
    const leftLen = this._left.length as i32;
    // @ts-ignore
    const passed = isArray<T>() && leftLen == value;
    this._resolve(passed, "toHaveLength", leftLen.toString(), value.toString());
  }

  /**
   * Tests if an array contains an element
   */
  // @ts-ignore
  toContain(value: valueof<T>): void {
    // @ts-ignore
    const passed = isArray<T>() && this._left.includes(value);
    this._resolve(
      passed,
      "toContain",
      q("includes value"),
      q("does not include value"),
    );
  }

  /**
   * Tests if serialized value matches stored snapshot.
   */
  toMatchSnapshot(name: string = ""): void {
    let key = this._snapshotKey;
    if (name.length) key += "::" + name;

    const actual = stringifyValue<T>(this._left);
    const res = snapshotAssert(key, actual);
    this._resolve(res.ok, "toMatchSnapshot", actual, res.expected);
  }

  /**
   * Delegates throw assertions to try-as when available.
   * If try-as is unavailable, this matcher is disabled and warns once.
   */
  toThrow(): void {
    // @ts-ignore
    if (!isDefined(AS_TEST_TRY_AS)) {
      if (!warnedToThrowDisabled) {
        sendWarning(
          'toThrow() is disabled because try-as is not installed. Install and import "try-as" to enable it.',
        );
        warnedToThrowDisabled = true;
      }
      this._resolve(true, "toThrow", q("disabled"), q("disabled"));
      return;
    }

    // @ts-ignore
    const passed = __ExceptionState.Failures > 0;
    if (passed) {
      // @ts-ignore
      __ExceptionState.Failures--;
    }
    this._resolve(passed, "toThrow", q("throws"), q("throws"));
  }

  /**
   * Tests for equality
   */
  toBe(equals: T): void {
    let passed = false;
    if (isArray<T>()) {
      // @ts-ignore
      passed = arrayEquals(this._left, equals);
    } else if (
      isBoolean<T>() ||
      isString<T>() ||
      isInteger<T>() ||
      isFloat<T>()
    ) {
      passed = this._left === equals;
    } else {
      // Fallback for reference/value types where strict equality is not enough.
      passed = stringifyValue<T>(this._left) == stringifyValue<T>(equals);
    }

    this._resolve(
      passed,
      "toBe",
      stringifyValue<T>(this._left),
      stringifyValue<T>(equals),
    );
  }
}

function arrayEquals<T extends any[]>(a: T, b: T): boolean {
  if (a.length != b.length) return false;
  return stringifyValue(a) == stringifyValue(b);
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
  return quote(value);
}
