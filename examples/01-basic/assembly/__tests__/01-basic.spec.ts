import { describe, expect, run, test } from "as-test";

describe("01 basic", () => {
  test("adds numbers", () => {
    expect(2 + 3).toBe(5);
  });

  test("compares values", () => {
    expect(10).toBeGreaterThan(3);
    expect(3).toBeLessThan(10);
  });
});

run();
