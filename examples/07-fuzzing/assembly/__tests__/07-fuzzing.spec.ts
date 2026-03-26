import { describe, expect, test } from "as-test";

describe("07 fuzzing", () => {
  test("keeps ordinary specs alongside fuzzers", () => {
    expect("fuzz".length).toBe(4);
  });
});
