import { Verdict } from "..";
import { TestGroup } from "../src/group";

export class TapReporter {
    public groups: TestGroup[];
    constructor(groups: TestGroup[]) {
        this.groups = groups;
    }
    report(): string {
        let out = "TAP version 14\n";
        let totalTests: i32 = this.groups.length;

        out += "1.." + totalTests.toString();
        for (let i = 0; i < this.groups.length; i++) {
            const group = unchecked(this.groups[i]);
            if (group.verdict === Verdict.Ok) {
                out += `\nok ${i} - ${group.description}`;
            } else if (group.verdict === Verdict.Fail) {
                out += `\nnot ok ${i} - ${group.description}`;
                out += "  ---";
                out += `  message: '${group.description}'`;
                out += `  severity: fail`;
                for (let ii = 0; ii < group.results.length; ii++) {
                    const res = unchecked(group.results[ii]);
                    if (res.verdict === Verdict.Ok) continue;
                    
                }
            }
        }
    }
}