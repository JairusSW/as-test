import { describe, expect, test } from "as-test";

describe("09 mode configs shared", () => {
  test("uses the root spec input", () => {
    expect("shared".length).toBe(6);
  });
});
