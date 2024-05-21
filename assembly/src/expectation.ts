import { Variant } from "as-variant/assembly";
import { TestResult, Verdict } from "./result";
import { rainbow } from "as-rainbow";
import { visualize } from "../util";

export class Expectation {
    public verdict: Verdict = Verdict.Unreachable;
    public left: Variant;
    public right!: Variant;
    constructor(left: Variant) {
        this.left = left;
    }
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
        if (this.verdict === Verdict.Ok) return rainbow.green(" - Test completed successfully");

        const left = visualize<T>(this.left.getUnchecked<T>())
        const right = visualize<T>(this.right.getUnchecked<T>());

        let leftDiff = "";
        let rightDiff = "";

        for (let i = 0; i < min(left.length, right.length); i++) {
            const lChar = left.charAt(i);
            const rChar = right.charAt(i);
            if (lChar != rChar) {
                leftDiff += rainbow.green(lChar);
                rightDiff += rainbow.red(rChar);
            } else {
                leftDiff += lChar;
                rightDiff += rChar;
            }
        }

        return rainbow.red(" - Test failed") + "\n" + rainbow.italicMk(`  (expected) ${leftDiff}\n  (recieved) ${rightDiff}`);
    }
}