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
        return rainbow.red(" - Test failed") + "\n" + rainbow.italicMk(`  - (expected) ${visualize<T>(this.left.getUnchecked<T>())}\n    Does not equal\n  - (recieved) ${visualize<T>(this.right.getUnchecked<T>())}`);
    }
}