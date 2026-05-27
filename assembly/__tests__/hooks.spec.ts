// Exercises the optional `kinds` argument to beforeEach/afterEach, which
// controls which suite kinds the hook fires around. By default hooks fire only
// for test cases (test/it/only); a kinds list opts specific kinds in — here
// `describe` (a grouping block) is opted into beforeEach.

import { afterEach, beforeEach, describe, expect, test } from "..";

let before = 0;
let after = 0;

// beforeEach runs before each `describe` AND each `test`; afterEach runs only
// after each `test`.
beforeEach(() => {
  before++;
}, ["describe", "test"]);

afterEach(() => {
  after++;
}, ["test"]);

describe("hook kinds", () => {
  // Entering the describe fired beforeEach once (describe is in its kinds), and
  // nothing has fired afterEach yet.
  test("fires before describe + this test, not after yet", () => {
    // Entering this test fired beforeEach again → 2 (describe + this test).
    expect(before).toBe(2);
    expect(after).toBe(0);
  });

  test("keeps firing per test; afterEach only counts finished tests", () => {
    // describe(1) + first(1) + this test(1) = 3 beforeEach fires so far.
    expect(before).toBe(3);
    // The first test finished, so its afterEach ran once.
    expect(after).toBe(1);
  });
});
