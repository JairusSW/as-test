import { afterEach, beforeEach, describe, expect, run, test } from "..";
import "try-as";

let beforeCount = 0;
let afterCount = 0;

beforeEach(() => {
  beforeCount++;
});

afterEach(() => {
  afterCount++;
});

describe("Expectation helpers", () => {
  test("not modifier inverts matcher verdict", () => {
    expect(1).not.toBe(2);
    expect(2).toBe(2);
  });

  test("truthy and falsy matchers", () => {
    expect(true).toBeTruthy();
    expect(false).toBeFalsy();
    expect(1).toBeTruthy();
    expect(0).toBeFalsy();
    expect("as-test").toBeTruthy();
    expect("").toBeFalsy();
  });

  test("close-to and string matchers", () => {
    expect(3.14159).toBeCloseTo(3.14, 2);
    expect("AssemblyScript testing").toMatch("testing");
  });

  test("custom message argument compiles and runs", () => {
    expect(10, "math should still work").toBe(10);
  });

  test("toThrow supports direct throw assertions with try-as", () => {
    expect(new Map<string, string>().get("invalid")).toThrow();
    expect(1).toBe(1);
  });

  test("toThrow fails for non-throwing expressions", () => {
    expect(10).not.toThrow();
  });

  test("beforeEach/afterEach are called once per test", () => {
    expect(beforeCount).toBe(7);
    expect(afterCount).toBe(6);
  });
});

run({
  log: false,
});
