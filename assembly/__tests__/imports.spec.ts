import "as-test";
import { expect } from "as-test";

describe("import styles", () => {
  test("works with side-effect import only", () => {
    const value = 1 + 1;
    expect(value).toBe(2);
  });

  test("works with side-effect and direct imports together", () => {
    expect("as-test").toContain("test");
  });
});
