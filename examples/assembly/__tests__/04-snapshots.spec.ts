import { describe, expect, run, test } from "as-test";

describe("04 snapshots", () => {
  test("unnamed snapshot", () => {
    const payload = "snapshot-demo-v1";
    expect(payload).toMatchSnapshot();
  });

  test("named snapshot", () => {
    expect("named-snapshot-demo").toMatchSnapshot("named");
  });
});

run();
