import { visualize } from "../util/helpers";
import { Tests } from "./tests";
import { after_each_callback, before_each_callback } from "..";

@json
export class Expectation<T> extends Tests {
  public verdict: string = "none";
  private _left: T;
  // @ts-ignore
  private _right: u64 = 0;
  // @ts-ignore
  private _not: boolean = false;
  constructor(left: T) {
    super();
    this._left = left;
  }
  get not(): Expectation<T> {
    this._not = true;
    return this;
  }

  /**
   * Tests if a == null
   * @returns - void
   */
  toBeNull(): void {
    this.verdict =
      isNullable<T>() && changetype<usize>(this._left)
        ? "ok"
        : "fail";

    // @ts-ignore
    store<T>(changetype<usize>(this), null, offsetof<Expectation<T>>("_right"));

    this.instr = "toBeNull";

    this.left = visualize<T>(this._left);
    this.right = visualize<T>(
      load<T>(changetype<usize>(this), offsetof<Expectation<T>>("_right")),
    );

    // @ts-ignore
    if (after_each_callback) after_each_callback();
    // @ts-ignore
    if (before_each_callback) before_each_callback();
  }

  /**
   * Tests if a > b
   * @param number equals - The value to test
   * @returns - void
   */
  toBeGreaterThan(value: T): void {
    if (!isInteger<T>() && !isFloat<T>())
      ERROR("toBeGreaterThan() can only be used on number types!");

    this.verdict = this._left > value ? "ok" : "fail";
    store<T>(
      changetype<usize>(this),
      value,
      offsetof<Expectation<T>>("_right"),
    );

    this.instr = "toBeGreaterThan";

    this.left = visualize<T>(this._left);
    this.right = visualize<T>(
      load<T>(changetype<usize>(this), offsetof<Expectation<T>>("_right")),
    );

    // @ts-ignore
    if (after_each_callback) after_each_callback();
    // @ts-ignore
    if (before_each_callback) before_each_callback();
  }

  /**
   * Tests if a >= b
   * @param number equals - The value to test
   * @returns - void
   */
  toBeGreaterOrEqualTo(value: T): void {
    if (!isInteger<T>() && !isFloat<T>())
      ERROR("toBeGreaterOrEqualTo() can only be used on number types!");

    this.verdict = this._left >= value ? "ok" : "fail";
    store<T>(
      changetype<usize>(this),
      value,
      offsetof<Expectation<T>>("_right"),
    );

    this.instr = "toBeGreaterThanOrEqualTo";

    this.left = visualize<T>(this._left);
    this.right = visualize<T>(
      load<T>(changetype<usize>(this), offsetof<Expectation<T>>("_right")),
    );

    // @ts-ignore
    if (after_each_callback) after_each_callback();
    // @ts-ignore
    if (before_each_callback) before_each_callback();
  }

  /**
   * Tests if a < b
   * @param number equals - The value to test
   * @returns - void
   */
  toBeLessThan(value: T): void {
    if (!isInteger<T>() && !isFloat<T>())
      ERROR("toBeLessThan() can only be used on number types!");

    this.verdict = this._left < value ? "ok" : "fail";
    store<T>(
      changetype<usize>(this),
      value,
      offsetof<Expectation<T>>("_right"),
    );

    this.instr = "toBeLessThan";

    this.left = visualize<T>(this._left);
    this.right = visualize<T>(
      load<T>(changetype<usize>(this), offsetof<Expectation<T>>("_right")),
    );

    // @ts-ignore
    if (after_each_callback) after_each_callback();
    // @ts-ignore
    if (before_each_callback) before_each_callback();
  }

  /**
   * Tests if a <= b
   * @param number equals - The value to test
   * @returns - void
   */
  toBeLessThanOrEqualTo(value: T): void {
    if (!isInteger<T>() && !isFloat<T>())
      ERROR("toBeLessThanOrEqualTo() can only be used on number types!");

    this.verdict = this._left <= value ? "ok" : "fail";
    store<T>(
      changetype<usize>(this),
      value,
      offsetof<Expectation<T>>("_right"),
    );

    this.instr = "toBeLessThanOrEqualTo";

    this.left = visualize<T>(this._left);
    this.right = visualize<T>(
      load<T>(changetype<usize>(this), offsetof<Expectation<T>>("_right")),
    );

    // @ts-ignore
    if (after_each_callback) after_each_callback();
    // @ts-ignore
    if (before_each_callback) before_each_callback();
  }

  /**
   * Tests if a is string
   * @returns - void
   */
  toBeString(): void {
    this.verdict = isString<T>() ? "ok" : "fail";

    this.left = nameof<T>();
    this.right = "string";

    this.instr = "toBeString";

    // @ts-ignore
    if (after_each_callback) after_each_callback();
    // @ts-ignore
    if (before_each_callback) before_each_callback();
  }

  /**
   * Tests if a is boolean
   * @returns - void
   */
  toBeBoolean(): void {
    this.verdict = isBoolean<T>() ? "ok" : "fail";

    this.left = nameof<T>();
    this.right = "boolean";

    this.instr = "toBeBoolean";

    // @ts-ignore
    if (after_each_callback) after_each_callback();
    // @ts-ignore
    if (before_each_callback) before_each_callback();
  }

  /**
   * Tests if a is array
   * @returns - void
   */
  toBeArray(): void {
    this.verdict = isArray<T>() ? "ok" : "fail";

    this.left = nameof<T>();
    this.right = "Array<any>";

    this.instr = "toBeArray";

    // @ts-ignore
    if (after_each_callback) after_each_callback();
    // @ts-ignore
    if (before_each_callback) before_each_callback();
  }

  /**
   * Tests if a is number
   * @returns - void
   */
  toBeNumber(): void {
    this.verdict = isFloat<T>() || isInteger<T>() ? "ok" : "fail";

    this.left = nameof<T>();
    this.right = "number";

    this.instr = "toBeNumber";

    // @ts-ignore
    if (after_each_callback) after_each_callback();
    // @ts-ignore
    if (before_each_callback) before_each_callback();
  }

  /**
   * Tests if a is integer
   * @returns - void
   */
  toBeInteger(): void {
    this.verdict = isInteger<T>() ? "ok" : "fail";

    this.left = nameof<T>();
    this.right = "float";

    this.instr = "toBeInteger";

    // @ts-ignore
    if (after_each_callback) after_each_callback();
    // @ts-ignore
    if (before_each_callback) before_each_callback();
  }

  /**
   * Tests if a is float
   * @returns - void
   */
  toBeFloat(): void {
    this.verdict = isFloat<T>() ? "ok" : "fail";

    this.left = nameof<T>();
    this.right = "integer";

    this.instr = "toBeFloat";

    // @ts-ignore
    if (after_each_callback) after_each_callback();
    // @ts-ignore
    if (before_each_callback) before_each_callback();
  }

  /**
   * Tests if a is finite
   * @returns - void
   */
  toBeFinite(): void {
    this.verdict =
      // @ts-ignore
      (isFloat<T>() || isInteger<T>()) && isFinite(this._left)
        ? "ok"
        : "fail";

    this.left = "Infinity";
    this.right = "Finite";

    this.instr = "toBeFinite";

    // @ts-ignore
    if (after_each_callback) after_each_callback();
    // @ts-ignore
    if (before_each_callback) before_each_callback();
  }

  /**
   * Tests if an array has length x
   *
   * @param {i32} value - The value to check
   * @returns - void
   */
  toHaveLength(value: i32): void {
    this.verdict =
      // @ts-ignore
      isArray<T>() && this._left.length == value ? "ok" : "fail";

    // @ts-ignore
    this.left = this._left.length.toString();
    this.right = value.toString();

    this.instr = "toHaveLength";

    // @ts-ignore
    if (after_each_callback) after_each_callback();
    // @ts-ignore
    if (before_each_callback) before_each_callback();
  }

  /**
   * Tests if an array contains an element
   *
   * @param { valueof<T> } value - The value to check
   * @returns - void
   */
  // @ts-ignore
  toContain(value: valueof<T>): void {
    this.verdict =
      // @ts-ignore
      isArray<T>() && this._left.includes(value) ? "ok" : "fail";

    // @ts-ignore
    this.left = "includes value";
    this.right = "does not include value";
    this.instr = "toContain";

    // @ts-ignore
    if (after_each_callback) after_each_callback();
    // @ts-ignore
    if (before_each_callback) before_each_callback();
  }

  /**
   * Tests for equality
   * @param {T} equals - The value to test
   * @returns - void
   */
  toBe(equals: T): void {
    store<T>(
      changetype<usize>(this),
      equals,
      offsetof<Expectation<T>>("_right"),
    );
    if (isBoolean<T>()) {
      this.verdict = this._left === equals ? "ok" : "fail";
    } else if (isString<T>()) {
      this.verdict = this._left === equals ? "ok" : "fail";
    } else if (isInteger<T>() || isFloat<T>()) {
      this.verdict = this._left === equals ? "ok" : "fail";
    } else if (isArray<T>()) {
      // getArrayDepth<T>();
    } else {
      this.verdict = "none";
    }

    this.instr = "toBe";

    this.left = visualize<T>(this._left);
    this.right = visualize<T>(
      load<T>(changetype<usize>(this), offsetof<Expectation<T>>("_right")),
    );

    // @ts-ignore
    if (after_each_callback) after_each_callback();
    // @ts-ignore
    if (before_each_callback) before_each_callback();
  }
}
