import { Verdict } from "..";

export class Tests {
  public type!: string;
  public verdict: Verdict = Verdict.None;
  public left: string = "";
  public right: string = "";
  public instr: string = "";
}

export class ReportLogs {
  passed: string | null;
  failed: string | null;
}
