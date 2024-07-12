import { describe, expect, test, run, it } from "..";

const myArray: i32[] = [1, 2, 3];

describe("Array manipulation", () => {
  test("Array length", () => {
    expect(myArray).toHaveLength(3);
  });

  test("Array inclusion", () => {
    expect(myArray).toContain(2);
  });

  it("should be empty", () => {});
});

run({
  log: false,
});