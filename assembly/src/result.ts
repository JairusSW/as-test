import { Variant } from "as-variant/assembly";

export enum Verdict {
    Unreachable,
    Ok,
    Fail,
}

export class TestResult {
    public verdict: Verdict = Verdict.Unreachable;
    public left: Variant;
    public right!: Variant;
    constructor(left: Variant) {
        this.left = left;
    }
    toBe<T>(equals: T): TestResult {
        return this;
    }

    report(): string {
        
    }
}