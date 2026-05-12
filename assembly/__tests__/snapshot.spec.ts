import { describe, expect, namedSnapshotKey, nextUnnamedSnapshotKey, test } from "..";

describe("Snapshot support", () => {
  test("string snapshot", () => {
    const value = "snapshot-value-v1";
    expect(value).toMatchSnapshot();
  });

  test("snapshot key helpers work without active suite state", () => {
    expect(nextUnnamedSnapshotKey("base-key")).toBe("base-key");
    expect(namedSnapshotKey("base-key", "named")).toBe("base-key [named]");
  });

  test("named snapshot", () => {
    expect("named-value").toMatchSnapshot("named");
  });
});
