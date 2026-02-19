import {
  describe,
  expect,
  run,
  test,
  xdescribe,
  xexpect,
  xit,
  xtest,
} from "as-test";

let skippedCallbacksRan = 0;

xtest("xtest block is skipped", () => {
  skippedCallbacksRan += 1;
  expect(1).toBe(2);
});

xit("xit block is skipped", () => {
  skippedCallbacksRan += 1;
  expect("skip").toBe("run");
});

xdescribe("xdescribe block is skipped", () => {
  test("inside xdescribe", () => {
    skippedCallbacksRan += 1;
    expect(10).toBe(20);
  });
});

describe("06 skips", () => {
  test("xexpect skips matcher evaluation", () => {
    xexpect("as-test").toStartWith("ts");
    expect(1).toBe(1);
  });

  test("skipped callbacks do not run", () => {
    expect(skippedCallbacksRan).toBe(0);
  });
});

run();
