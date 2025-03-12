import { describe, expect, test, run, it } from "..";

const myArray: i32[] = [1, 2, 3];

describe("Array manipulation", () => {
  // test("Array length", () => {
  //   expect("foo").toBe("foo")
  // });

  // test("Array inclusion", () => {
  //   expect(myArray).toContain(2);
  // });

  test("Array check", () => {
    const a = [1, 2, 3];
    const b = [1, 2, 3];
    expect(a).toBe(b);
  });

  it("should be empty", () => {});
});

run({
  log: true,
});
