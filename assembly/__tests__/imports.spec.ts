import { describe, expect, test } from "as-test";

describe("import styles", () => {
  test("works with explicit named imports", () => {
    const value = 1 + 1;
    expect(value).toBe(2);
  });

  test("supports multiple named helpers from the same import", () => {
    expect("as-test").toContain("test");
  });
});
