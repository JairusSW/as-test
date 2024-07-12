import { rainbow } from "as-rainbow";
import { diff, visualize } from "../util/helpers";
import { Tests } from "./tests";
import { Verdict, after_each_callback, before_each_callback } from "..";

export class Expectation<T> extends Tests {
  public type: string = "Expectation";
  public verdict: Verdict = Verdict.None;
  private _left: T;
  // @ts-ignore
  private _right: u64 = 0;
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
        ? Verdict.Ok
        : Verdict.Fail;

    // @ts-ignore
    store<T>(changetype<usize>(this), null, offsetof<Expectation<T>>("_right"));

    this.instr = "toBeNull";

    this.left = visualize<T>(this._left);
    this.right = visualize<T>(load<T>(changetype<usize>(this), offsetof<Expectation<T>>("_right")));

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

    this.verdict = this._left > value ? Verdict.Ok : Verdict.Fail;
    store<T>(changetype<usize>(this), value, offsetof<Expectation<T>>("_right"));

    this.instr = "toBeGreaterThan";

    this.left = visualize<T>(this._left);
    this.right = visualize<T>(load<T>(changetype<usize>(this), offsetof<Expectation<T>>("_right")));

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

    this.verdict = this._left >= value ? Verdict.Ok : Verdict.Fail;
    store<T>(changetype<usize>(this), value, offsetof<Expectation<T>>("_right"));

    this.instr = "toBeGreaterThanOrEqualTo"

    this.left = visualize<T>(this._left);
    this.right = visualize<T>(load<T>(changetype<usize>(this), offsetof<Expectation<T>>("_right")));

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

    this.verdict = this._left < value ? Verdict.Ok : Verdict.Fail;
    store<T>(changetype<usize>(this), value, offsetof<Expectation<T>>("_right"));

    this.instr = "toBeLessThan"

    this.left = visualize<T>(this._left);
    this.right = visualize<T>(load<T>(changetype<usize>(this), offsetof<Expectation<T>>("_right")));

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

    this.verdict = this._left <= value ? Verdict.Ok : Verdict.Fail;
    store<T>(changetype<usize>(this), value, offsetof<Expectation<T>>("_right"));

    this.instr = "toBeLessThanOrEqualTo"

    this.left = visualize<T>(this._left);
    this.right = visualize<T>(load<T>(changetype<usize>(this), offsetof<Expectation<T>>("_right")));

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

    this.left = nameof<T>();
    this.right = "string";

    this.instr = "toBeString"

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

    this.left = nameof<T>();
    this.right = "boolean";

    this.instr = "toBeBoolean"

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

    this.left = nameof<T>();
    this.right = "Array<any>";

    this.instr = "toBeArray"

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

    this.left = nameof<T>();
    this.right = "number";

    this.instr = "toBeNumber"

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

    this.left = nameof<T>();
    this.right = "float";

    this.instr = "toBeInteger"

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

    this.left = nameof<T>();
    this.right = "integer";

    this.instr = "toBeFloat"

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
        ? Verdict.Ok
        : Verdict.Fail;

    this.left = "Infinity";
    this.right = "Finite";

    this.instr = "toBeFinite"

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
      isArray<T>() && this._left.length == value ? Verdict.Ok : Verdict.Fail;

    // @ts-ignore
    this.left = this._left.length.toString();
    this.right = value.toString();

    this.instr = "toHaveLength"

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
      isArray<T>() && this._left.includes(value) ? Verdict.Ok : Verdict.Fail;

    // @ts-ignore
    this.left = "includes value";
    this.right = "does not include value";
    this.instr = "toContain"

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
      this.verdict = this._left === equals ? Verdict.Ok : Verdict.Fail;
    } else if (isString<T>()) {
      this.verdict = this._left === equals ? Verdict.Ok : Verdict.Fail;
    } else if (isInteger<T>() || isFloat<T>()) {
      this.verdict = this._left === equals ? Verdict.Ok : Verdict.Fail;
    } else if (isArray<T>()) {
      // getArrayDepth<T>();
    } else {
      this.verdict = Verdict.None;
    }

    this.instr = "toBe";

    this.left = visualize<T>(this._left);
    this.right = visualize<T>(load<T>(changetype<usize>(this), offsetof<Expectation<T>>("_right")));

    // @ts-ignore
    if (after_each_callback) after_each_callback();
    // @ts-ignore
    if (before_each_callback) before_each_callback();
  }

  report(): string | null {
    if (!this._not && this.verdict === Verdict.Ok) return null;

    const left = this.left || visualize(this._left);
    const right =
      this.right ||
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
