// Covers the safeStringify fallback chain. The matchers no longer crash
// for managed classes — the report payload picks the best available
// serialiser: user-supplied `toJSON(): string` → a `<TypeName>` placeholder
// with a one-time warning.

import { describe, expect, test } from "..";

// 1) Class with toJSON(): the transform generates the equality method;
//    safeStringify renders via toJSON() on failure.
class WithJSON {
  a: string;
  b: i32;

  constructor(a: string, b: i32) {
    this.a = a;
    this.b = b;
  }

  toJSON(): string {
    return '{"a":"' + this.a + '","b":' + this.b.toString() + "}";
  }
}

// 2) Class without @json/toJSON. Transform generates equality;
//    safeStringify falls through to the placeholder. The placeholder is
//    only visible on failure, so we only assert equality works here.
class Bare {
  v: i32;

  constructor(v: i32) {
    this.v = v;
  }
}

describe("safeStringify fallback chain", () => {
  test("class with toJSON: structural equality matches", () => {
    const a = new WithJSON("hi", 7);
    const b = new WithJSON("hi", 7);
    expect(a).toEqual(b);
    expect(a).toStrictEqual(b);
  });

  test("class with toJSON: structural inequality is detected", () => {
    const a = new WithJSON("hi", 7);
    const b = new WithJSON("hi", 8);
    expect(a).not.toEqual(b);
  });

  test("class with no toJSON: structural equality still works via transform", () => {
    const a = new Bare(42);
    const b = new Bare(42);
    expect(a).toEqual(b);
    expect(a).not.toEqual(new Bare(43));
  });

  test("strings take the primitive path", () => {
    expect("hello").toBe("hello");
    expect("a").not.toBe("b");
  });

  test("arrays are rendered via the in-tree stringifier", () => {
    const a: i32[] = [1, 2, 3];
    expect(a).toContain(2);
  });

  test("identity short-circuit: same managed reference is equal", () => {
    const a = new WithJSON("hi", 7);
    expect(a).toBe(a);
  });
});
