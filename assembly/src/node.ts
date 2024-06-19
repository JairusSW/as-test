import { Verdict } from "..";

export class Node {
    public verdict: Verdict = Verdict.Unreachable;
    report(): string | null {
        return "ERROR"
    }
}