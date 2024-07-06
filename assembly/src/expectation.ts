import { rainbow } from "as-rainbow";
import { diff, visualize } from "../util/helpers";
import { Node } from "./node";
import { Verdict, after_each_callback, before_each_callback } from "..";

export class Expectation<T> extends Node {
  public verdict: Verdict = Verdict.Unreachable;
  private left: T;
  private _left: string | null = null;
  private right: u64 = 0;
  private _right: string | null = null;
  private _not: boolean = false;
  private op: string = "=";
  constructor(left: T) {
    super();
    this.left = left;
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
      isNullable<T>() && changetype<usize>(this.left)
        ? Verdict.Ok
        : Verdict.Fail;

    // @ts-ignore
    store<T>(changetype<usize>(this), null, offsetof<Expectation<T>>("right"));

    this.op = "=";

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

    this.verdict = this.left > value ? Verdict.Ok : Verdict.Fail;
    store<T>(changetype<usize>(this), value, offsetof<Expectation<T>>("right"));

    this.op = ">";

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

    this.verdict = this.left >= value ? Verdict.Ok : Verdict.Fail;
    store<T>(changetype<usize>(this), value, offsetof<Expectation<T>>("right"));

    this.op = ">=";

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

    this.verdict = this.left < value ? Verdict.Ok : Verdict.Fail;
    store<T>(changetype<usize>(this), value, offsetof<Expectation<T>>("right"));

    this.op = "<";

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

    this.verdict = this.left <= value ? Verdict.Ok : Verdict.Fail;
    store<T>(changetype<usize>(this), value, offsetof<Expectation<T>>("right"));

    this.op = "<=";

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
    this.verdict = isString<T>() ? Verdict.Ok : Verdict.Fail;

    this._left = nameof<T>();
    this._right = "string";

    this.op = "type";

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
    this.verdict = isBoolean<T>() ? Verdict.Ok : Verdict.Fail;

    this._left = nameof<T>();
    this._right = "boolean";

    this.op = "type";

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
    this.verdict = isArray<T>() ? Verdict.Ok : Verdict.Fail;

    this._left = nameof<T>();
    this._right = "Array<any>";

    this.op = "type";

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
    this.verdict = isFloat<T>() || isInteger<T>() ? Verdict.Ok : Verdict.Fail;

    this._left = nameof<T>();
    this._right = "number";

    this.op = "type";

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
    this.verdict = isInteger<T>() ? Verdict.Ok : Verdict.Fail;

    this._left = nameof<T>();
    this._right = "float";

    this.op = "type";

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
    this.verdict = isFloat<T>() ? Verdict.Ok : Verdict.Fail;

    this._left = nameof<T>();
    this._right = "integer";

    this.op = "type";

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
    // @ts-ignore
    this.verdict =
      (isFloat<T>() || isInteger<T>()) && isFinite(this.left)
        ? Verdict.Ok
        : Verdict.Fail;

    this._left = "Infinity";
    this._right = "Finite";

    this.op = "=";

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
    // @ts-ignore
    this.verdict =
      isArray<T>() && this.left.length == value ? Verdict.Ok : Verdict.Fail;

    // @ts-ignore
    this._left = this.left.length.toString();
    this._right = value.toString();

    this.op = "length";

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
    // @ts-ignore
    this.verdict =
      isArray<T>() && this.left.includes(value) ? Verdict.Ok : Verdict.Fail;

    // @ts-ignore
    this._left = "includes value";
    this._right = "does not include value";
    this.op = "=";

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
      offsetof<Expectation<T>>("right"),
    );
    if (isBoolean<T>()) {
      this.verdict = this.left === equals ? Verdict.Ok : Verdict.Fail;
    } else if (isString<T>()) {
      this.verdict = this.left === equals ? Verdict.Ok : Verdict.Fail;
    } else if (isInteger<T>() || isFloat<T>()) {
      this.verdict = this.left === equals ? Verdict.Ok : Verdict.Fail;
    } else if (isArray<T>()) {
      // getArrayDepth<T>();
    } else {
      this.verdict = Verdict.Unreachable;
    }

    this.op = "=";

    // @ts-ignore
    if (after_each_callback) after_each_callback();
    // @ts-ignore
    if (before_each_callback) before_each_callback();
  }

  report(): string | null {
    if (!this._not && this.verdict === Verdict.Ok) return null;

    const left = this._left || visualize(this.left);
    const right =
      this._right ||
      visualize(
        load<T>(changetype<usize>(this), offsetof<Expectation<T>>("right")),
      );

    if (this._not) {
      if (this.verdict === Verdict.Fail) return null;
      const dif = diff(left, right, true);
      return (
        rainbow.red(" - Test failed") +
        "\n" +
        rainbow.italicMk(
          `  ${rainbow.dimMk("(expected) ->")} ${dif.left.toString()}\n  ${rainbow.dimMk("[ !" + this.op + " ]")}\n  ${rainbow.dimMk("(recieved) ->")} ${dif.right.toString()}`,
        )
      );
    }

    if (left == right) return null;

    const dif = diff(left, right);

    return (
      rainbow.red(" - Test failed") +
      "\n" +
      rainbow.italicMk(
        `  ${rainbow.dimMk("(expected) ->")} ${dif.left.toString()}\n  ${rainbow.dimMk("[ " + this.op + " ]")}\n  ${rainbow.dimMk("(recieved) ->")} ${dif.right.toString()}`,
      )
    );
  }
}
