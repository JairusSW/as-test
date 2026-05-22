import { describe, test, expect, mode, AS_TEST_MODE_NAME, run } from "..";

// This project's modes all have `default: true`, so `AS_TEST_MODE_NAME` is
// always a real mode name (`node:bindings` or `node:wasi`), never `"default"`.
// The gates below are written against those concrete names.

let bindingsGatedRan: i32 = 0;
let notBindingsGatedRan: i32 = 0;
let arrayPositiveRan: i32 = 0;
let arrayNegativeRan: i32 = 0;
let arrayMixedRan: i32 = 0;

mode(["node:bindings"], () => {
  describe("mode(['node:bindings'])", () => {
    test("runs only when AS_TEST_MODE_NAME == node:bindings", () => {
      bindingsGatedRan++;
      expect(AS_TEST_MODE_NAME).toBe("node:bindings");
    });
  });
});

mode(["!node:bindings"], () => {
  describe("mode(['!node:bindings'])", () => {
    test("runs only when AS_TEST_MODE_NAME != node:bindings", () => {
      notBindingsGatedRan++;
      expect(AS_TEST_MODE_NAME == "node:bindings").toBe(false);
    });
  });
});

mode(["node:bindings", "node:wasi"], () => {
  describe("mode(['node:bindings', 'node:wasi'])", () => {
    test("runs in either bindings or wasi", () => {
      arrayPositiveRan++;
      expect(
        AS_TEST_MODE_NAME == "node:bindings" ||
          AS_TEST_MODE_NAME == "node:wasi",
      ).toBe(true);
    });
  });
});

mode(["!node:bindings", "!node:wasi"], () => {
  describe("mode(['!node:bindings', '!node:wasi'])", () => {
    test("runs only when mode is neither", () => {
      arrayNegativeRan++;
      expect(
        AS_TEST_MODE_NAME != "node:bindings" &&
          AS_TEST_MODE_NAME != "node:wasi",
      ).toBe(true);
    });
  });
});

mode(["node:wasi", "!node:bindings"], () => {
  describe("mode(['node:wasi', '!node:bindings'])", () => {
    test("positive 'node:wasi' AND not node:bindings", () => {
      arrayMixedRan++;
      expect(AS_TEST_MODE_NAME).toBe("node:wasi");
    });
  });
});

describe("mode gating: counters", () => {
  test("counters reflect the gates that fired in this mode", () => {
    if (AS_TEST_MODE_NAME == "node:bindings") {
      expect(bindingsGatedRan).toBe(1);
      expect(notBindingsGatedRan).toBe(0);
      expect(arrayPositiveRan).toBe(1);
      expect(arrayNegativeRan).toBe(0);
      expect(arrayMixedRan).toBe(0);
    } else if (AS_TEST_MODE_NAME == "node:wasi") {
      expect(bindingsGatedRan).toBe(0);
      expect(notBindingsGatedRan).toBe(1);
      expect(arrayPositiveRan).toBe(1);
      expect(arrayNegativeRan).toBe(0);
      expect(arrayMixedRan).toBe(1);
    } else {
      // Unknown mode (e.g. a browser mode): sanity-check negation only.
      expect(bindingsGatedRan).toBe(0);
      expect(notBindingsGatedRan).toBe(1);
    }
  });
});

// Sanity: empty array gates to nothing — the inside must never run.
mode([], () => {
  describe("empty-array-should-never-register", () => {
    test("would fail if it ran", () => {
      expect("empty-array-ran").toBe("never-runs");
    });
  });
});

run();
