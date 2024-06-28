import { Verdict } from "..";

export class Node {
  public verdict: Verdict = Verdict.Unreachable;
  report(): string | null {
    return null;
  }
}

export class ReportLogs {
  passed: string | null;
  failed: string | null;
}
