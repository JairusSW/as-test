import { describe, expect, it, test } from "../..";

describe("Nested array.spec.ts (basename collides with sibling at __tests__ root)", () => {
  test("disambiguated artifact resolves correctly", () => {
    const a = [4, 5, 6];
    const b = [4, 5, 6];
    expect(a).toEqual(b);
  });

  it("runs in the nested subdirectory build", () => {
    expect(1 + 1).toBe(2);
  });
});
