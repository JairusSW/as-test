import {
  describe,
  expect,
  only,
  test,
  todo,
  xdescribe,
  xexpect,
  xit,
  xonly,
  xtest,
} from "..";

let ran = 0;
let focusedRan = 0;
let unfocusedRan = 0;

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

describe("todo and only helpers", () => {
  only("only runs the focused test", () => {
    focusedRan++;
    expect(true).toBe(true);
  });

  xonly("xonly stays skipped", () => {
    unfocusedRan++;
    expect(false).toBe(true);
  });

  test("non-focused sibling is skipped", () => {
    unfocusedRan++;
  });

  todo("placeholder test");
});

test("only skipped unfocused siblings", () => {
  expect(focusedRan).toBe(1);
  expect(unfocusedRan).toBe(0);
});
