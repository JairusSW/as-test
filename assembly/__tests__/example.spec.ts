import {
  describe,
  expect,
  test,
  beforeAll,
  run
} from "..";

describe("Math operations", () => {

  test("Addition", () => {
    expect(1 + 2).toBe(3);
  });

  test("Comparison", () => {
    expect(5).toBeGreaterThan(3);
    expect(2).toBeLessThan(4);
  });
});

let myArray: i32[] = [1, 2, 3];

describe("Array manipulation", () => {

  test("Array length", () => {
    expect(myArray).toHaveLength(3);
  });

  test("Array inclusion", () => {
    expect(myArray).toContain(2);
  });
});

function foo(): void {}

run({
  log: false,
});
