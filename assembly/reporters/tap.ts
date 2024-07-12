import { Verdict } from "..";
import { Suite } from "../src/suite";

export class TapReporter {
  public groups: Suite[];
  constructor(groups: Suite[]) {
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
        for (let ii = 0; ii < group.tests.length; ii++) {
          const res = unchecked(group.tests[ii]);
          if (res.verdict === Verdict.Ok) continue;
        }
      }
    }
  }
}
