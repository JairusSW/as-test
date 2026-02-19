import {
  describe,
  expect,
  test,
  xdescribe,
  xexpect,
  xit,
  xtest,
} from "..";

let ran = 0;

xtest("xtest is skipped", () => {
  ran++;
  expect(1).toBe(2);
});

xit("xit is skipped", () => {
  ran++;
  expect("skip").toBe("run");
});

xdescribe("xdescribe is skipped", () => {
  ran++;
  test("nested skipped test", () => {
    ran++;
    expect(10).toBe(20);
  });
});

describe("skip helpers", () => {
  test("xexpect skips matcher execution result", () => {
    xexpect("as-test").toStartWith("ts");
  });
});

test("skipped callbacks were not executed", () => {
  expect(ran).toBe(0);
});
