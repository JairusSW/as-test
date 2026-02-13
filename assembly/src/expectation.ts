import { visualize } from "../util/helpers";
import { Tests } from "./tests";
import { JSON } from "json-as";


@json
export class Expectation<T> extends Tests {
  public verdict: string = "none";
  public right: JSON.Raw = JSON.Raw.from("");
  public left: JSON.Raw = JSON.Raw.from("");

  @omit
  private _left: T;

  @omit
  // @ts-ignore
  private _right: u64 = 0;

  @omit
  // @ts-ignore
  private _not: boolean = false;

  @omit
  private _message: string = "";

  constructor(left: T, message: string = "") {
    super();
    this._left = left;
    this._message = message;
  }

  get not(): Expectation<T> {
    this._not = true;
    return this;
  }

  private _resolve(
    passed: bool,
    instr: string,
    left: string,
    right: string,
  ): void {
    const isFail = this._not ? passed : !passed;
    this.verdict = isFail ? "fail" : "ok";
    this.instr = instr;
    this.left.set(left);
    this.right.set(right);
    this.message = isFail ? this._message : "";
    this._not = false;
  }

  /**
   * Tests if a == null
   */
  toBeNull(): void {
    const passed =
      ((isNullable<T>() && changetype<usize>(this._left) == 0) ||
        (isInteger<T>() && nameof<T>() == "usize" && this._left == 0));

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
    if (!isString<T>())
      ERROR("toMatch() can only be used on string types!");
    // @ts-ignore
    const passed = this._left.indexOf(value) >= 0;
    // @ts-ignore
    this._resolve(passed, "toMatch", q(this._left as string), q(value));
  }

  /**
   * Tests if an array has length x
   */
  toHaveLength(value: i32): void {
    // @ts-ignore
    const leftLen = this._left.length as i32;
    // @ts-ignore
    const passed = isArray<T>() && leftLen == value;
    this._resolve(
      passed,
      "toHaveLength",
      leftLen.toString(),
      value.toString(),
    );
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
   * Tests for equality
   */
  toBe(equals: T): void {
    let passed = false;
    if (isArray<T>()) {
      // @ts-ignore
      passed = arrayEquals(this._left, equals);
    } else if (isBoolean<T>() || isString<T>() || isInteger<T>() || isFloat<T>()) {
      passed = this._left === equals;
    } else {
      // Fallback for reference/value types where strict equality is not enough.
      passed = JSON.stringify<T>(this._left) == JSON.stringify<T>(equals);
    }

    this._resolve(
      passed,
      "toBe",
      JSON.stringify<T>(this._left),
      JSON.stringify<T>(equals),
    );
  }
}

function arrayEquals<T extends any[]>(a: T, b: T): boolean {
  if (a.length != b.length) return false;
  return JSON.stringify(a) == JSON.stringify(b);
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
