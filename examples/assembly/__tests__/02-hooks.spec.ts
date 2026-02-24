import { afterEach, beforeEach, describe, expect, run, test } from "as-test";

let beforeCount = 0;
let afterCount = 0;

beforeEach(() => {
  beforeCount += 1;
});

afterEach(() => {
  afterCount += 1;
});

describe("02 hooks", () => {
  test("first test sees first beforeEach run", () => {
    expect(beforeCount).toBe(1);
    expect(afterCount).toBe(0);
  });

  test("second test sees previous afterEach run", () => {
    expect(beforeCount).toBe(2);
    expect(afterCount).toBe(1);
  });
});

run();
