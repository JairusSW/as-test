import { Result, Time, describe, expect, test } from "..";
import { Expectation } from "../src/expectation";
import { Log } from "../src/log";
import { Suite } from "../src/suite";
import { Tests } from "../src/tests";

expect("top-level expectation").toBe("top-level expectation");

describe("internal helpers", () => {
  test("base test records serialize cleanly", () => {
    const record = new Tests();
    record.order = 3;
    record.type = "expectation";
    record.verdict = "ok";
    record.left = "1";
    record.right = "2";
    record.instr = "toBe";
    record.message = "serialized";
    record.location = "assembly/example.ts:1:1";

    const serialized = record.serialize();
    expect(serialized).toContain('"order":3');
    expect(serialized).toContain('"type":"expectation"');
    expect(serialized).toContain('"message":"serialized"');
  });

  test("suite and log serialization include nested children", () => {
    const suite = new Suite("root", (): void => {}, "describe");
    suite.file = "manual.spec.ts";

    const child = new Suite("child", (): void => {}, "test");
    suite.addSuite(child);

    const assertion = new Expectation<i32>(1, "", "snap", "manual.ts:1:1");
    assertion.toBe(1);
    suite.addExpectation(assertion);

    const log = new Log("manual log");
    suite.addLog(log);

    const serialized = suite.serialize();
    expect(serialized).toContain('"file":"manual.spec.ts"');
    expect(serialized).toContain('"description":"root"');
    expect(serialized).toContain('"description":"child"');
    expect(serialized).toContain('"text":"manual log"');
  });

  test("result display and serialization cover pass and fail branches", () => {
    const failed = new Result("spec", 2, 3);
    const passed = new Result("spec", 0, 3);

    expect(failed.display()).toContain("failed");
    expect(passed.display()).toContain("0 failed");
    expect(failed.serialize()).toContain('"arg1":2');
    expect(failed.serialize()).toContain('"arg2":3');
  });

  test("time formatting handles positive and negative durations", () => {
    const positive = new Time();
    positive.start = 0.0;
    positive.end = 1500.0;

    const negative = new Time();
    negative.start = 5.0;
    negative.end = 4.0;

    expect(positive.format().length > 0).toBe(true);
    expect(negative.format()).toBe("0.00μs");
    expect(positive.serialize()).toContain('"start":0');
    expect(positive.serialize()).toContain('"end":1500');
  });
});
