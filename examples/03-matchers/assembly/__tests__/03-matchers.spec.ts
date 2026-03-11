import { describe, expect, run, test } from "as-test";

describe("03 matchers", () => {
  test("numeric matchers", () => {
    expect(3.14159).toBeCloseTo(3.14, 2);
    expect(8).toBeGreaterOrEqualTo(8);
    expect(8).toBeLessThanOrEqualTo(8);
    expect(1).toBeTruthy();
    expect(0).toBeFalsy();
  });

  test("string and array matchers", () => {
    expect("assemblyscript").toMatch("script");
    expect("as-test").toStartWith("as");
    expect("as-test").toEndWith("test");

    const values = [1, 2, 3];
    expect(values).toHaveLength(3);
    expect(values).toContain(2);
  });
});

run();
