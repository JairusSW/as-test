import { describe, expect, run, test } from "..";

describe("Snapshot support", () => {
  test("string snapshot", () => {
    const value = "snapshot-value-v1";
    expect(value).toMatchSnapshot();
  });

  test("named snapshot", () => {
    expect("named-value").toMatchSnapshot("named");
  });
});
