import { Verdict } from "./result";
import { rainbow } from "as-rainbow";
import { diff, visualize } from "../util";
import { Node } from "./node";

export class Expectation<T> extends Node {
    public verdict: Verdict = Verdict.Unreachable;
    public left: T;
    public right!: T;
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
    toBeNull(): Expectation<T> {
        this.verdict = (isNullable<T>() && changetype<usize>(this.left)) ? Verdict.Ok : Verdict.Fail;

        // @ts-ignore
        this.right = null;
        
        this.op = "="

        return this;
    }
    /**
     * Tests if a > b
     * @param number equals - The value to test
     * @returns - Expectation
     */
    toBeGreaterThan(value: T): Expectation<T> {
        if (!isInteger<T>() && !isFloat<T>()) throw new Error("toBeGreaterThan() can only be used on number types. Received " + nameof<T>() + " instead!");
        
        this.verdict = this.left > value ? Verdict.Ok : Verdict.Fail;
        this.right = value;

        this.op = ">";

        return this;
    }
    /**
     * Tests if a >= b
     * @param number equals - The value to test
     * @returns - Expectation
     */
    toBeGreaterOrEqualTo(value: T): Expectation<T> {
        if (!isInteger<T>() && !isFloat<T>()) throw new Error("toBeGreaterOrEqualTo() can only be used on number types. Received " + nameof<T>() + " instead!");
        
        this.verdict = this.left >= value ? Verdict.Ok : Verdict.Fail;
        this.right = value;

        this.op = ">=";

        return this;
    }
    /**
     * Tests if a < b
     * @param number equals - The value to test
     * @returns - Expectation
     */
    toBeLessThan(value: T): Expectation<T> {
        if (!isInteger<T>() && !isFloat<T>()) throw new Error("toBeLessThan() can only be used on number types. Received " + nameof<T>() + " instead!");
        
        this.verdict = this.left < value ? Verdict.Ok : Verdict.Fail;
        this.right = value;

        this.op = "<";

        return this;
    }
    /**
     * Tests if a <= b
     * @param number equals - The value to test
     * @returns - Expectation
     */
    toBeLessThanOrEqualTo(value: T): Expectation<T> {
        if (!isInteger<T>() && !isFloat<T>()) throw new Error("toBeLessThanOrEqualTo() can only be used on number types. Received " + nameof<T>() + " instead!");
        
        this.verdict = this.left <= value ? Verdict.Ok : Verdict.Fail;
        this.right = value;

        this.op = "<=";

        return this;
    }
    /**
     * Tests for equality
     * @param any equals - The value to test
     * @returns - Expectation
     */
    toBe(equals: T): Expectation<T> {
        this.right = equals;
        if (isBoolean<T>()) {
            this.verdict = this.left === this.right
                ? Verdict.Ok
                : Verdict.Fail;

        } else if (isString<T>()) {
            this.verdict = this.left === this.right
                ? Verdict.Ok
                : Verdict.Fail;
        } else if (isInteger<T>() || isFloat<T>()) {
            this.verdict = this.left === this.right
                ? Verdict.Ok
                : Verdict.Fail;
        } else if (isArray<T>()) {
            // getArrayDepth<T>();
        } else {
            this.verdict = Verdict.Unreachable;
        }

        this.op = "=";

        return this;
    }

    report(): string | null {
        if (!this._not && this.verdict === Verdict.Ok) return null;

        const left = visualize(this.left);
        const right = visualize(this.right);

        if (this._not) {
            if (this.verdict === Verdict.Fail) return null;
            const dif = diff(left, right, true);
            return rainbow.red(" - Test failed") + "\n" + rainbow.italicMk(`  ${rainbow.dimMk("(expected) ->")} ${dif.left.toString()}\n  ${rainbow.dimMk("[ !" + this.op + " ]")}\n  ${rainbow.dimMk("(recieved) ->")} ${dif.right.toString()}`);
        }

        if (left == right) return null;

        const dif = diff(left, right);

        return rainbow.red(" - Test failed") + "\n" + rainbow.italicMk(`  ${rainbow.dimMk("(expected) ->")} ${dif.left.toString()}\n  ${rainbow.dimMk("[ " + this.op + " ]")}\n  ${rainbow.dimMk("(recieved) ->")} ${dif.right.toString()}`);
    }
}