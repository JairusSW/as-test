import { describe, expect, test, run } from "..";

describe("Math operations", () => {
  test("Addition", () => {
    expect(1 + 2).toBe(3);
  });

  test("Comparison", () => {
    expect(5).toBeGreaterThan(3);
    expect(2).toBeLessThan(4);
  });

  test("Approximation", () => {
    expect(3.14159).toBeCloseTo(3.14, 2);
  });
});

run({
  log: false,
});
