import { Variant } from "as-variant/assembly";
import { Verdict } from "./result";
import { rainbow } from "as-rainbow";
import { visualize } from "../util";
import { StringSink } from "as-string-sink/assembly";

export class Expectation {
    public verdict: Verdict = Verdict.Unreachable;
    public left: Variant;
    public right!: Variant;
    private _not: boolean = false;
    constructor(left: Variant) {
        this.left = left;
    }
    not(): Expectation {
        this._not = true;
        return this;
    }
    /**
     * Tests for strict equality
     * @param any equals - The value to test
     * @returns - Expectation
     */
    toBe<T>(equals: T): Expectation {
        this.right = Variant.from(equals);
        if (this.left.id !== this.right.id) throw "cannot compare different types";

        if (isBoolean<T>()) {
            this.verdict = this.left.getUnchecked<T>() === this.right.getUnchecked<T>()
                ? Verdict.Ok
                : Verdict.Fail;

        } else if (isString<T>()) {
            this.verdict = this.left.getUnchecked<T>() === this.right.getUnchecked<T>()
                ? Verdict.Ok
                : Verdict.Fail;
        } else if (isInteger<T>() || isFloat<T>()) {
            this.verdict = this.left.getUnchecked<T>() === this.right.getUnchecked<T>()
                ? Verdict.Ok
                : Verdict.Fail;
        } else if (isArray<T>()) {
            // getArrayDepth<T>();
        } else {
            this.verdict = Verdict.Unreachable;
        }

        console.log(this.report<T>());

        return this;
    }

    report<T>(): string {
        if (!this.not && this.verdict === Verdict.Ok) {
            return rainbow.green(" - Test completed successfully");
        }

        const left = visualize<T>(this.left.getUnchecked<T>());
        const right = visualize<T>(this.right.getUnchecked<T>());

        if (this._not) {
            if (this.verdict === Verdict.Fail) return rainbow.green(" - Test completed successfully");
            return rainbow.red(" - Test failed") + "\n" + rainbow.italicMk(`  ${rainbow.dimMk("(expected) ->")} ${rainbow.bgGreen(left.toString())}\n  ${rainbow.dimMk("(recieved) ->")} ${rainbow.bgRed(right.toString())}`);
        }

        let leftDiff = StringSink.withCapacity(left.length);
        let rightDiff = StringSink.withCapacity(right.length);

        let i = 0

        for (; i < min(left.length, right.length); i++) {
            const lChar = left.charAt(i);
            const rChar = right.charAt(i);
            if (lChar != rChar) {
                leftDiff.write(rainbow.bgGreen(lChar));
                rightDiff.write(rainbow.bgRed(rChar));
            } else {
                leftDiff.write(lChar);
                rightDiff.write(rChar);
            }
        }

        for (; i < left.length; i++) {
            leftDiff.write(rainbow.bgGreen(left.charAt(i)));
            rightDiff.write(rainbow.bgRed(" "));
        }
        for (; i < right.length; i++) rightDiff.write(rainbow.bgRed(right.charAt(i)));

        return rainbow.red(" - Test failed") + "\n" + rainbow.italicMk(`  ${rainbow.dimMk("(expected) ->")} ${leftDiff.toString()}\n  ${rainbow.dimMk("(recieved) ->")} ${rightDiff.toString()}`);
    }
}