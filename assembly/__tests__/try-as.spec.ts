// @ts-ignore
import { Exception } from "try-as";
import { describe, expect, test } from "../index";

describe("toThrow", () => {
  test("passes when the wrapped callback throws", () => {
    expect((): void => {
      throw new Error("boom");
    }).toThrow();
  });

  test("fails when the wrapped callback does not throw", () => {
    expect((): void => {
      const _x: i32 = 1 + 1;
    }).not.toThrow();
  });
});

describe("try/catch/finally", () => {
  test("catches a thrown Error and exposes its message", () => {
    let caught = false;
    let message = "";
    try {
      throw new Error("inner-boom");
    } catch (e) {
      const err = e as Exception;
      caught = true;
      message = err.toString();
    }
    expect(caught).toBe(true);
    expect(message.includes("inner-boom")).toBe(true);
  });

  test("finally runs whether or not the body throws", () => {
    let counter = 0;
    try {
      counter++;
    } finally {
      counter++;
    }
    expect(counter).toBe(2);

    let afterCatch = false;
    try {
      throw new Error("x");
    } catch (e) {
      afterCatch = true;
    } finally {
      counter++;
    }
    expect(afterCatch).toBe(true);
    expect(counter).toBe(3);
  });
});
